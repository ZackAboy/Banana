import type { CSSProperties } from "react";
/** Position of a child inside a `.stagger` list, used to offset its entrance. */
export const order = (i: number) => ({ "--i": i }) as CSSProperties;
