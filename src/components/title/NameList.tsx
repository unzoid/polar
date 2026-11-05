import { Fragment } from "react";

/**
 * People's names joined by commas, each isolated (`<bdi>`), so an Arabic or Hebrew name among Latin ones keeps its
 * place instead of the line being reordered around it.
 */
export function NameList({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={i}>
          {i > 0 && ", "}
          <bdi>{name}</bdi>
        </Fragment>
      ))}
    </>
  );
}
