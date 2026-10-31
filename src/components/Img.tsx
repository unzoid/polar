import { useState, type ImgHTMLAttributes } from "react";

/** An image that fades in once decoded instead of painting top-to-bottom. */
export function Img({ className = "", onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  if (!props.src) return null;
  return (
    <img
      decoding="async"
      loading="lazy"
      draggable={false}
      {...props}
      className={`img-fade ${className}`}
      data-loaded={loaded}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
    />
  );
}
