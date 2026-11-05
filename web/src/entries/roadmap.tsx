import { render } from "solid-js/web";
import { For, Show } from "solid-js";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Smooth } from "../components/Smooth";
import { reveal } from "../lib/reveal";
import { GROUPS, ITEMS, type Status } from "../data/roadmap";

const ISSUES = "https://github.com/unzoid/polarity/issues";

function Badge(props: { status: Status; children: string }) {
  return (
    <span
      class="inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold tracking-[-0.005em]"
      style={{ background: `var(--${props.status}-bg)`, color: `var(--${props.status}-ink)` }}
    >
      {props.children}
    </span>
  );
}

function Roadmap() {
  return (
    <Layout>
      <section class="px-6 pt-36 text-center sm:pt-44">
        <h1 class="enter text-display" style={{ "--rise": "16px", "--dur": "800ms" }}>
          Roadmap
        </h1>
        <p class="enter text-lede mx-auto mt-5 max-w-[32rem] text-mute" style={{ "--rise": "10px", "--delay": "100ms" }}>
          Features in progress and planned.
        </p>
        <div class="enter mt-9" style={{ "--rise": "8px", "--delay": "180ms" }}>
          <a
            href={`${ISSUES}/new`}
            class="press inline-flex h-10 items-center rounded-full border border-hair bg-tile px-5 text-[0.9375rem] font-medium hover:border-faint/40"
          >
            Suggest a feature
          </a>
        </div>
      </section>

      <For each={GROUPS}>
        {(group) => {
          const items = ITEMS.filter((i) => i.status === group.status);
          return (
            <Show when={items.length}>
              <section class="mx-auto mt-28 max-w-[1080px] px-6 sm:mt-36">
                <header ref={reveal} class="reveal">
                  <h2 class="text-title">{group.title}</h2>
                  <p class="mt-2 text-mute">{group.body}</p>
                </header>
                <ul ref={reveal} class="reveal mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={items}>
                    {(item) => {
                      const body = (
                        <Smooth radius={24} class="h-full bg-tile p-7">
                          <Badge status={item.status}>{group.badge}</Badge>
                          <h3 class="mt-4 text-xl font-semibold tracking-[-0.022em]">{item.title}</h3>
                          <p class="mt-2 text-mute">{item.body}</p>
                        </Smooth>
                      );
                      return (
                        <li>
                          {item.issue ? (
                            <a href={`${ISSUES}/${item.issue}`} class="block h-full transition-[filter] duration-200 hover:brightness-[0.97] dark:hover:brightness-125">
                              {body}
                            </a>
                          ) : (
                            body
                          )}
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            </Show>
          );
        }}
      </For>
    </Layout>
  );
}

render(() => <Roadmap />, document.getElementById("root")!);
