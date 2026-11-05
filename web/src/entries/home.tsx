import { render } from "solid-js/web";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Hero } from "../components/Hero";
import { Showcase } from "../components/Showcase";
import { Features } from "../components/Features";
import { Faq } from "../components/Faq";
import { reveal } from "../lib/reveal";
import { DownloadButton, ReleaseNote } from "../components/Download";
import { Footnotes } from "../components/Footnotes";
import { OpenSource } from "../components/OpenSource";

function Home() {
  return (
    <Layout>
      <Hero />
      <Showcase />
      <Features />
      <OpenSource />
      <Faq />
      <section ref={reveal} class="reveal mt-32 flex flex-col items-center px-6 text-center sm:mt-48">
        <h2 class="text-headline">Download Polarity</h2>
        <div class="mt-10 flex flex-col items-center gap-4">
          <DownloadButton />
          <ReleaseNote />
        </div>
      </section>
      <Footnotes />
    </Layout>
  );
}

render(() => <Home />, document.getElementById("root")!);
