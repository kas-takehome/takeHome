import { writeFileSync } from "node:fs";
import { hashPassword } from "./auth";

let password = "";
for await (const chunk of process.stdin) {
  password += String(chunk);
  if (password.length > 256)
    throw new Error("Password must contain at most 256 characters.");
}
password = password.replace(/\r?\n$/, "");
if (password.length < 12)
  throw new Error(
    "Provide a password of at least 12 characters on standard input.",
  );
const passwordHash = await hashPassword(password);
writeFileSync(
  ".env.local",
  `ADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH=${passwordHash}\n`,
  {
    mode: 0o600,
    flag: "wx",
  },
);
console.info(
  "Admin configured in ignored .env.local. Existing files are never overwritten.",
);
