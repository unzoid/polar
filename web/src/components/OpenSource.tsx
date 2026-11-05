import { reveal } from "../lib/reveal";
import { GitHubButton, REPO_URL } from "./GitHub";

export function OpenSource() {
  return (
    <section id="open-source" class="mx-auto mt-32 max-w-[1080px] px-6 text-center sm:mt-48">
      <div ref={reveal} class="reveal">
        <h2 class="text-headline">Open source</h2>
        <p class="text-lede mx-auto mt-5 max-w-[34rem] text-balance text-mute">
          Polarity's code is on GitHub under the MIT license. Read it, build it yourself, report bugs or suggest features.
        </p>
        <div class="mt-10 flex flex-wrap justify-center gap-3">
          <GitHubButton />
          <a
            href={`${REPO_URL}/issues`}
            class="press inline-flex h-12 items-center rounded-full px-5 text-[1.0625rem] font-medium text-icon hover:underline"
          >
            Issues and requests
          </a>
        </div>
      </div>
    </section>
  );
}
