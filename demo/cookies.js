// Demo only: the Cookie header as an object, in place of cookie-parser; the demo reads two cookies.
export function parseCookies(header = "") {
  const cookies = Object.create(null);
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    const name = part.slice(0, at).trim();
    if (at > 0 && !(name in cookies)) cookies[name] = decode(part.slice(at + 1).trim());
  }
  return cookies;
}

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;   // a stray % is kept as it is, never an error
  }
};
