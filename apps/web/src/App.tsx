import { useEffect, useState } from "react";

export function App() {
	const [apiStatus, setApiStatus] = useState<"checking" | "up" | "down">(
		"checking",
	);

	useEffect(() => {
		fetch("/api/health")
			.then((res) => setApiStatus(res.ok ? "up" : "down"))
			.catch(() => setApiStatus("down"));
	}, []);

	return (
		<main>
			<h1>Open Print Stack</h1>
			<p>API: {apiStatus}</p>
		</main>
	);
}
