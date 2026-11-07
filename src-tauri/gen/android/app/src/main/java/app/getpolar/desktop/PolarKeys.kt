package app.getpolar.desktop

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The phone's keychain for src-tauri/src/keychain.rs: the sign-in session, list services' sign-ins,
 * API keys and add-on links. Each value is sealed with an AES-256-GCM key the Android Keystore keeps
 * and never hands out, its name bound in as associated data, and written to a file of its own in
 * the app's no-backup folder: neither the sealed files nor the web view's storage they replace go
 * into a device backup, and a copy of the files is useless without this device's key.
 *
 * A value the key can't open any more (the key is gone or invalidated) reads as none, as a fresh
 * install would: the app signs in again rather than staying stuck.
 */
object PolarKeys {
  private const val ALIAS = "polar-keys"
  private const val FOLDER = "polar-keys"
  private const val NONCE = 12
  private const val TAG_BITS = 128
  private val NAME = Regex("^[A-Za-z0-9._-]{1,96}$")
  private val lock = Any()

  private fun file(context: Context, name: String): File {
    require(NAME.matches(name) && name != "." && name != "..") { "not a key name" }
    return File(File(context.noBackupFilesDir, FOLDER), name)
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
  }

  @JvmStatic
  fun get(context: Context, name: String): ByteArray? = synchronized(lock) {
    val f = file(context, name)
    if (!f.exists()) return null
    val sealed = f.readBytes()
    if (sealed.size < NONCE + TAG_BITS / 8) return null
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 0, NONCE))
      cipher.updateAAD(name.toByteArray())
      cipher.doFinal(sealed, NONCE, sealed.size - NONCE)
    } catch (e: AEADBadTagException) {
      f.delete()
      null
    } catch (e: KeyPermanentlyInvalidatedException) {
      f.delete()
      null
    } catch (e: UnrecoverableKeyException) {
      f.delete()
      null
    }
  }

  @JvmStatic
  fun set(context: Context, name: String, value: ByteArray) = synchronized(lock) {
    val f = file(context, name)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    cipher.updateAAD(name.toByteArray())
    val sealed = cipher.iv + cipher.doFinal(value)
    check(cipher.iv.size == NONCE) { "unexpected nonce size" }
    f.parentFile?.mkdirs()
    // A whole file or the old one: written aside, then moved over it.
    val next = File(f.parentFile, "~$name")
    next.writeBytes(sealed)
    check(next.renameTo(f)) { "couldn't keep the value" }
  }

  @JvmStatic
  fun delete(context: Context, name: String) = synchronized(lock) {
    val f = file(context, name)
    check(!f.exists() || f.delete()) { "couldn't remove the value" }
  }
}
