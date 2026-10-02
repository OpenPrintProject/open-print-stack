import { useEffect, useState } from "react";
import { AuthForm } from "./AuthForm.tsx";
import { authClient } from "./auth.ts";

export function App() {
	const [apiStatus, setApiStatus] = useState<"checking" | "up" | "down">(
		"checking",
	);
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		fetch("/api/health")
			.then((res) => setApiStatus(res.ok ? "up" : "down"))
			.catch(() => setApiStatus("down"));
	}, []);

	return (
		<main>
			<h1>Open Print Stack</h1>
			<p>API: {apiStatus}</p>
			{isPending ? (
				<p>Loading…</p>
			) : session ? (
				<section>
					<p>Signed in as {session.user.email}</p>
					<button type="button" onClick={() => authClient.signOut()}>
						Sign out
					</button>
				</section>
			) : (
				<AuthForm />
			)}
		</main>
	);
}
