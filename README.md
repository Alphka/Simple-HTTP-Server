<h1 align="center">Simple HTTP Server</h1>

<p align="center">A simple command-line HTTP server in Node.js that serves static files from a local directory.</p>

<p align="center"><a href="LICENSE.md"><img alt="License: ISC" src="https://img.shields.io/badge/license-ISC-blue.svg"></a></p>

## Features

- Serves any local directory over HTTP (the current directory by default, or one chosen with `-d`).
- Generates an HTML directory listing for folders.
- Sets `Content-Type` according to the file extension (using the [`mime`](https://www.npmjs.com/package/mime) package), with `charset=utf-8` for text and JavaScript, and treats extensionless files as `application/octet-stream` (except `LICENSE`, served as plain text).
- Supports HTTP range requests (`Range`) for binary files, files larger than 3 MB, and video, audio, and image files.
- Listens on all IPv4 addresses (`0.0.0.0`) by default, so it is reachable from other devices on your network and through a router port forward; use `--host 127.0.0.1` to accept only connections from this machine.
- Rejects requests that resolve outside the served directory (HTTP 403), including encoded separators (`%2f`) and backslashes, and rejects null bytes and malformed URLs (HTTP 400).
- Logs every request to the console (IP, date, user agent, method, path, status, and requested range).
- Installable as a global `node-server` command via `npm link`.

## Tech stack

- [Node.js](https://nodejs.org/) (ES modules)
- [Express](https://expressjs.com/) 4
- [Pug](https://pugjs.org/) (directory listing template)
- [Commander](https://github.com/tj/commander.js) (command-line interface)
- [mime](https://www.npmjs.com/package/mime) (MIME type lookup)

## Requirements

- [Node.js](https://nodejs.org/) `22.18.0` or later. The runtime dependencies require only Node.js 10+, and the test script (`node --test` with glob arguments) needs Node.js 21+.
- npm.

## Installation

```bash
git clone https://github.com/Alphka/Simple-HTTP-Server.git
cd Simple-HTTP-Server
npm install --omit=dev
npm link
```

`npm link` registers the `node-server` command globally. If you prefer not to link it, skip that step and run the server with `npm start` (see below).

## Usage

```
Usage: node-server [options] [port]

Arguments:
  port                    Specify alternate port (default: 8000)

Options:
  -V, --version           output the version number
  -d, --directory <path>  Specify alternative directory (default: current directory)
  --host <address>        Specify the address to listen on (use 127.0.0.1 to accept only connections from this machine) (default: "0.0.0.0")
  -h, --help              display help for command
```

Examples:

```bash
# Serve the current directory at http://localhost:8000
node-server

# Serve the current directory on port 3000
node-server 3000

# Serve another directory (relative or absolute path) on port 8080
node-server -d ./public 8080

# Accept connections only from this machine
node-server --host 127.0.0.1
```

Without linking the command, run it from the project folder (the `--` passes the arguments to the script):

```bash
npm start -- 3000 -d ./public
```

Then open `http://localhost:<port>` in your browser. The server prints `Listening at http://<host>:<port>` when it is ready; stop it with `Ctrl+C`.

### Accessing from other devices

By default the server listens on `0.0.0.0` (all IPv4 interfaces), so other devices on your network can open `http://<your-machine-ip>:<port>`. You may need to allow Node.js through your firewall.

To make the server reachable from the internet, forward a port on your router to this machine's LAN IP and then open `http://<your-public-ip>:<port>`. Anyone who can reach that port can read every file in the served directory.

To keep the server reachable only from this machine, pass `--host 127.0.0.1`. Pass any other address to listen on that specific local interface only.

> [!NOTE]
> If the port is not a valid number, the server falls back to `8000`. If the directory given with `-d` does not exist, the command exits with an error.

> [!WARNING]
> This is a development tool with no authentication, no HTTPS and no rate limiting. Everything inside the served directory is readable by anyone who can reach the server. A router port forward makes it reachable from the internet, so serve only a dedicated folder, stop the server when you are done, and use `--host 127.0.0.1` when other devices do not need access.

## Project structure

```
src/
  index.js        CLI entry point and Express server
  template.pug    Directory listing template
```

## Testing

The test suite uses the built-in `node:test` runner (no extra dependencies). It starts the server on random local ports and checks serving, range requests, path traversal protection, and `--host`:

```bash
npm ci
npm test
```

No linter is configured.

## License

[ISC](LICENSE.md) © 2022 Kayo Souza
