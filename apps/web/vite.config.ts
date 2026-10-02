import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		// The API serves everything under /api, so the app and its session
		// cookie share one origin.
		proxy: {
			"/api": "http://localhost:3000",
		},
	},
});
