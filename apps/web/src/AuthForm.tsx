import { type FormEvent, useState } from "react";
import { authClient } from "./auth.ts";

type Mode = "sign-in" | "sign-up";

export function AuthForm() {
	const [mode, setMode] = useState<Mode>("sign-in");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const email = String(form.get("email"));
		const password = String(form.get("password"));

		setPending(true);
		setError(null);
		const { error } =
			mode === "sign-up"
				? await authClient.signUp.email({
						name: String(form.get("name")),
						email,
						password,
					})
				: await authClient.signIn.email({ email, password });
		setPending(false);
		if (error) setError(error.message ?? "Something went wrong");
	}

	return (
		<form onSubmit={submit}>
			<h2>{mode === "sign-up" ? "Create an account" : "Sign in"}</h2>
			{mode === "sign-up" && (
				<label>
					Name <input name="name" autoComplete="name" required />
				</label>
			)}
			<label>
				Email <input name="email" type="email" autoComplete="email" required />
			</label>
			<label>
				Password{" "}
				<input
					name="password"
					type="password"
					autoComplete={
						mode === "sign-up" ? "new-password" : "current-password"
					}
					minLength={8}
					required
				/>
			</label>
			{error && <p role="alert">{error}</p>}
			<button type="submit" disabled={pending}>
				{mode === "sign-up" ? "Create account" : "Sign in"}
			</button>
			<button
				type="button"
				onClick={() => {
					setMode(mode === "sign-up" ? "sign-in" : "sign-up");
					setError(null);
				}}
			>
				{mode === "sign-up"
					? "I already have an account"
					: "Create an account instead"}
			</button>
		</form>
	);
}
