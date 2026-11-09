// Sets a new password (and optionally a new sign-in email) for an admin
// account, straight in the database configured by .env / the environment.
// The password is typed without being shown and never printed or logged.
//
//   npm run admin:password
//
// Use it to replace bootstrap/default credentials after provisioning.
import process from "node:process";
import readline from "node:readline";
import nextEnv from "@next/env";
import bcrypt from "bcryptjs";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd(), false, { error: () => {}, info: () => {} });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
	console.error("DATABASE_URL is not set.");
	process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: isLocal ? undefined : { rejectUnauthorized: false } });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

/** Reads a line without echoing what is typed. */
function askHidden(question) {
	return new Promise((resolve) => {
		const write = rl._writeToOutput;
		rl._writeToOutput = (text) => {
			if (text.includes(question)) write.call(rl, text);
		};
		rl.question(question, (answer) => {
			rl._writeToOutput = write;
			process.stdout.write("\n");
			resolve(answer);
		});
	});
}

function strengthProblem(password) {
	if (password.length < 12) return "Use at least 12 characters.";
	const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
	if (kinds < 3) return "Mix at least three of: lowercase, uppercase, numbers, symbols.";
	if (/changeme|password|avokarto|admin/i.test(password)) return "Avoid common words like admin, password or the site name.";
	return null;
}

try {
	const { rows: admins } = await pool.query("SELECT id::text, email FROM app_users WHERE role = 'admin' ORDER BY created_at");
	if (!admins.length) throw new Error("No admin accounts found in this database.");

	console.log(`Database: ${new URL(databaseUrl).hostname}`);
	admins.forEach((admin, index) => console.log(`  ${index + 1}. ${admin.email}`));
	const pick = admins.length === 1 ? 1 : Number(await ask("Which admin (number)? "));
	const admin = admins[pick - 1];
	if (!admin) throw new Error("No such admin.");

	const newEmail = (await ask(`New sign-in email (Enter to keep ${admin.email}): `)).toLowerCase();
	if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new Error("That email doesn't look valid.");

	const password = await askHidden("New password (hidden): ");
	const problem = strengthProblem(password);
	if (problem) throw new Error(problem);
	if ((await askHidden("Repeat new password (hidden): ")) !== password) throw new Error("The passwords didn't match.");

	const hash = await bcrypt.hash(password, 12);
	await pool.query(
		"UPDATE app_users SET password_hash = $1, email = COALESCE(NULLIF($2, ''), email), status = 'active' WHERE id = $3",
		[hash, newEmail, admin.id],
	);
	console.log(`Updated. Sign in at /admin as ${newEmail || admin.email} with the new password.`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	rl.close();
	await pool.end();
}
