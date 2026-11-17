# JARVIS for iPhone

A mobile-first, installable PWA chat client for your existing Supabase project. It uses Supabase Auth for user sign-in and calls the `jarvis-chat` Edge Function with the signed-in user's session. The OpenAI API key belongs **only in the Edge Function's server-side secrets**, never in this app.

## Set up your Supabase project

1. In your Supabase project's dashboard, copy the **Project URL** and the **publishable key** (or legacy `anon` key). These are intended for public clients; do not use a `service_role` key here.
2. Deploy/configure your `jarvis-chat` Edge Function yourself, if it is not already available. Store its OpenAI API key in Supabase Edge Function secrets, and make the function verify the user's JWT and authorize access. Do not put that API key in this repository.
3. Configure the function to accept a JSON body shaped like:

   ```json
   {
     "messages": [
       { "role": "user", "content": "Hello" }
     ]
   }
   ```

   The app sends the recent conversation as `messages`. It accepts a plain-text response or a JSON response with `reply`, `answer`, `message`, `output`, `text`, or OpenAI-style `choices[0].message.content`.
4. Serve this directory over HTTPS (or `localhost` for local development). For example, from this folder run `python3 -m http.server 8000` and open `http://localhost:8000` on your development device.
5. In JARVIS, enter the Supabase Project URL, publishable/anon key, email, and password, then choose **Create account** or **Sign in**. The project URL and public client key are stored in this browser; your password is handled by Supabase Auth and is not saved by the app. If email confirmation is enabled, confirm your address before signing in.

The function must allow requests from the origin hosting this app (CORS) and enforce authentication/authorization itself. The app does not bypass Supabase Auth or call OpenAI directly. Browser history is stored locally on this device per signed-in user; use **Clear** to delete it.

## Install on iPhone

Open the HTTPS site in Safari, tap **Share**, then **Add to Home Screen**. Launch JARVIS from the Home Screen for a standalone app-like experience. Microphone input requires a supported browser and permission; typed chat remains available if speech recognition is unavailable. Spoken replies use the device's speech synthesis voices.

## Run and check locally

- No build step or npm dependencies are required. The Supabase JavaScript client is loaded from jsDelivr.
- `node --check app.js` checks the application JavaScript syntax.
- Serve over `localhost` to test the service worker and install flow. Supabase sign-in and chat require your project credentials and deployed Edge Function.
- No deployment or paid service is initiated by this project.
