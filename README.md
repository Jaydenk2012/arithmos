# Arithmos — GitHub + Render (no Firebase)

Arithmos is a two-player online number strategy game. This project runs a small Node.js + Express + Socket.IO server. No Firebase or database setup is required for a prototype.

## Publish it online

### 1. Put the project on GitHub
1. Download and unzip this project on your computer.
2. On GitHub, create a new repository named `arithmos`.
3. Choose **Add file → Upload files** and upload the *contents* of this folder (including `package.json`, `server.js`, `index.html`, and `render.yaml`), not the ZIP file itself.
4. Commit the files.

### 2. Deploy it on Render
1. Open https://render.com/ and sign in.
2. Choose **New → Web Service** and connect your GitHub account.
3. Select the `arithmos` repository.
4. Render reads `render.yaml`. If asked to enter commands manually, use:
   - Build command: `npm install`
   - Start command: `npm start`
5. Choose the Free plan if available and deploy.
6. Open the `onrender.com` URL Render provides and share it with your friend.

### 3. Play
- Player 1 opens the URL and creates a room.
- Player 1 shares the six-character room code.
- Player 2 opens the same URL on another device and enters the room code.
- Both choose two numbers and submit. The server reveals them only after both submissions arrive.

## Important free-hosting limitations

- Render's free web services can go idle after inactivity and may take about a minute to wake up.
- The current prototype stores active matches in server memory. If the server restarts, active rooms and games are lost. This is intentional to keep the first version simple; no persistent database is configured.
- Do not use GitHub Pages alone for this version: it serves static files and cannot run the Node.js + Socket.IO server needed for online rooms.

## Run locally (optional)

Requires Node.js. In this folder run:

```bash
npm install
npm start
```

Then open http://localhost:3000.
