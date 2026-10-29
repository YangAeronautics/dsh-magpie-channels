import { jsx as runtimeJsx } from "react/jsx-runtime";
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function split(props) {
  const { key, ...rest } = isObj(props) ? props : {};
  return { key, rest };
}
export function jsx(type, props, key) {
  const { key: propKey, rest } = split(props);
  const finalKey = key === undefined ? propKey : key;
  if (finalKey === undefined) return runtimeJsx(type, rest);
  return runtimeJsx(type, rest, finalKey);
}
