// cspell:ignore csecret fsecret fsite
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createServer, request } from "node:http"
import { connect } from "node:net"
import { networkInterfaces, tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js")

function getFreePort(){
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const { port } = /** @type {import("node:net").AddressInfo} */ (server.address())
			server.close(() => resolve(port))
		})
	})
}

/**
 * @param {string[]} args
 */
async function startServer(args){
	const port = await getFreePort()
	const child = spawn(process.execPath, [entry, String(port), ...args], { stdio: ["ignore", "pipe", "pipe"] })
	let output = ""

	child.stdout.setEncoding("utf8")
	child.stderr.setEncoding("utf8")
	child.stdout.on("data", chunk => output += chunk)
	child.stderr.on("data", chunk => output += chunk)

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Server did not start:\n" + output)), 10_000)

		child.once("exit", code => reject(new Error(`Server exited with code ${code}:\n${output}`)))
		child.stdout.on("data", () => {
			if(output.includes("Listening at")){
				clearTimeout(timer)
				resolve(undefined)
			}
		})
	})

	child.removeAllListeners("exit")

	return {
		port,
		getOutput: () => output,
		stop: () => new Promise(resolve => {
			if(child.exitCode !== null || child.signalCode !== null) return resolve(undefined)

			const forceTimer = setTimeout(() => child.kill("SIGKILL"), 3000)
			const giveUpTimer = setTimeout(resolve, 6000)

			child.once("exit", () => {
				clearTimeout(forceTimer)
				clearTimeout(giveUpTimer)
				resolve(undefined)
			})
			child.kill()
		})
	}
}

/**
 * @param {() => Awaited<ReturnType<typeof startServer>> | undefined} getServer
 * @param {() => Promise<void>} fn
 */
function withServerOutput(getServer, fn){
	return async () => {
		try{
			await fn()
		}catch(error){
			const output = getServer()?.getOutput()
			if(error instanceof Error && output) error.message += `
--- server output ---
${output}`
			throw error
		}
	}
}

/**
 * @param {number} port
 * @param {string} text
 * @returns {Promise<string>}
 */
function rawRequest(port, text){
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1", () => socket.write(text))
		let data = ""

		socket.setEncoding("utf8")
		socket.on("data", chunk => data += chunk)
		socket.on("end", () => resolve(data))
		socket.on("error", reject)
		socket.setTimeout(15_000, () => socket.destroy(new Error("Request timed out")))
	})
}

/**
 * @param {number} port
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @param {string} [host]
 * @returns {Promise<{ status: number, headers: import("node:http").IncomingHttpHeaders, body: string }>}
 */
function get(port, path, headers = {}, host = "127.0.0.1"){
	return new Promise((resolve, reject) => {
		const req = request({ host, port, path, headers, method: "GET", agent: false }, res => {
			const chunks = []

			res.on("data", chunk => chunks.push(chunk))
			res.on("end", () => resolve({
				status: res.statusCode,
				headers: res.headers,
				body: Buffer.concat(chunks).toString("utf8")
			}))
		})

		req.setTimeout(15_000, () => req.destroy(new Error("Request timed out")))
		req.on("error", reject)
		req.end()
	})
}

describe("Simple HTTP Server", () => {
	/** @type {string} */
	let base
	/** @type {string} */
	let root
	/** @type {Awaited<ReturnType<typeof startServer>>} */
	let server

	/**
	 * @param {string} name
	 * @param {...any} rest Optional options object, then the test function
	 */
	function itLogged(name, ...rest){
		const fn = rest.pop()
		return it(name, ...rest, withServerOutput(() => server, fn))
	}

	before(async () => {
		base = mkdtempSync(join(tmpdir(), "shs-test-"))
		root = join(base, "site")

		mkdirSync(join(root, "sub"), { recursive: true })
		mkdirSync(join(root, "odd #dir", "100%25&x"), { recursive: true })
		mkdirSync(join(base, "site_evil"))

		writeFileSync(join(root, "index.html"), "<h1>hi</h1>\n")
		writeFileSync(join(root, "sub", "a b.txt"), "hello\n")
		writeFileSync(join(root, "odd #dir", "f#1 %41&.txt"), "odd\n")
		writeFileSync(join(root, "odd #dir", "100%25&x", "in.txt"), "inner\n")
		writeFileSync(join(root, "big.bin"), Buffer.alloc(4096, 1))
		writeFileSync(join(base, "secret.txt"), "SECRET\n")
		writeFileSync(join(base, "site_evil", "x.txt"), "EVIL\n")

		server = await startServer(["-d", root])
	})

	after(async () => {
		await server?.stop()
		if(base) rmSync(base, { recursive: true, force: true })
	})

	describe("serving content", () => {
		itLogged("lists the root directory", async () => {
			const { status, headers, body } = await get(server.port, "/")

			assert.equal(status, 200)
			assert.match(headers["content-type"], /^text\/html/)
			assert.match(body, /Directory listing for \//)
			assert.match(body, /href="\/index\.html"/)
			assert.match(body, /href="\/sub\/"/)
		})

		itLogged("serves a file", async () => {
			const { status, headers, body } = await get(server.port, "/index.html")

			assert.equal(status, 200)
			assert.match(headers["content-type"], /^text\/html; charset=utf-8/)
			assert.equal(body, "<h1>hi</h1>\n")
		})

		itLogged("serves files with spaces and files in subdirectories", async () => {
			const { status, body } = await get(server.port, "/sub/a%20b.txt")

			assert.equal(status, 200)
			assert.equal(body, "hello\n")

			const listing = await get(server.port, "/sub/")

			assert.equal(listing.status, 200)
			assert.match(listing.body, /href="\/sub\/a%20b\.txt"/)
		})

		itLogged("normalizes dot segments inside the served directory", async () => {
			const { status, body } = await get(server.port, "/./sub/../index.html")

			assert.equal(status, 200)
			assert.equal(body, "<h1>hi</h1>\n")
		})

		itLogged("returns 404 for missing paths", async () => {
			const { status } = await get(server.port, "/nope")

			assert.equal(status, 404)
		})

		itLogged("encodes special characters in listing links, and the links resolve", async () => {
			const listing = await get(server.port, "/odd%20%23dir/")

			assert.equal(listing.status, 200)
			assert.match(listing.body, /href="\/odd%20%23dir\/f%231%20%2541%26\.txt"/)
			assert.match(listing.body, /href="\/odd%20%23dir\/100%2525%26x\/"/)

			const file = await get(server.port, "/odd%20%23dir/f%231%20%2541%26.txt")

			assert.equal(file.status, 200)
			assert.equal(file.body, "odd\n")

			const inner = await get(server.port, "/odd%20%23dir/100%2525%26x/in.txt")

			assert.equal(inner.status, 200)
			assert.equal(inner.body, "inner\n")
		})
	})

	describe("range requests", () => {
		itLogged("answers a valid range with 206 and logs the final status", async () => {
			const { status, headers, body } = await get(server.port, "/big.bin", { Range: "bytes=0-9" })

			assert.equal(status, 206)
			assert.equal(headers["content-range"], "bytes 0-9/4096")
			assert.equal(headers["accept-ranges"], "bytes")
			assert.equal(Buffer.byteLength(body), 10)

			await new Promise(resolve => setTimeout(resolve, 200))

			assert.match(server.getOutput(), /"GET \/big\.bin HTTP\/1\.1" 206 Range: 0-9/)
		})

		itLogged("answers an unsatisfiable range with 416", async () => {
			const { status } = await get(server.port, "/big.bin", { Range: "bytes=99999999-" })

			assert.equal(status, 416)
		})
	})

	describe("path traversal protection", () => {
		const forbidden = [
			["encoded slash", "/..%2fsecret.txt"],
			["encoded dots and slash", "/%2e%2e%2fsecret.txt"],
			["upper-case encoding", "/%2E%2E%2Fsecret.txt"],
			["encoded backslash", "/..%5csecret.txt"],
			["nested encoded slashes", "/sub/..%2f..%2fsecret.txt"],
			["sibling directory with the same prefix", "/..%2fsite_evil/x.txt"]
		]

		for(const [name, path] of forbidden){
			itLogged(`returns 403 for ${name}`, async () => {
				const { status, body } = await get(server.port, path)

				assert.equal(status, 403)
				assert.doesNotMatch(body, /SECRET|EVIL/)
			})
		}

		itLogged("does not expose files outside the root with plain dot segments", async () => {
			const { status, body } = await get(server.port, "/../secret.txt")

			assert.notEqual(status, 200)
			assert.doesNotMatch(body, /SECRET/)
		})

		itLogged("does not expose files outside the root with a leading double slash", async () => {
			const { body } = await get(server.port, "//secret.txt")

			assert.doesNotMatch(body, /SECRET/)
		})

		itLogged("returns 400 for null bytes", async () => {
			assert.equal((await get(server.port, "/%00")).status, 400)
			assert.equal((await get(server.port, "/index.html%00.png")).status, 400)
		})

		itLogged("returns 400 for malformed percent-encoding", async () => {
			assert.equal((await get(server.port, "/%E0%A4%A")).status, 400)
		})
	})

	describe("request handling", () => {
		itLogged("returns 400 for a missing Host header", async () => {
			const response = await rawRequest(server.port, "GET /index.html HTTP/1.1\r\nConnection: close\r\n\r\n")

			assert.match(response, /^HTTP\/1\.1 400 /)
			assert.doesNotMatch(response, /<h1>hi<\/h1>/)
		})

		itLogged("returns 400 for a malformed Host header", async () => {
			assert.equal((await get(server.port, "/index.html", { host: "[bad" })).status, 400)
			assert.equal((await get(server.port, "/index.html", { host: "a b:c:d" })).status, 400)
		})

		itLogged("logs the request time with hours, minutes and seconds", async () => {
			const before = Date.now()

			assert.equal((await get(server.port, "/index.html")).status, 200)

			await new Promise(resolve => setTimeout(resolve, 200))

			const line = server.getOutput().split("\n").filter(line => line.includes('"GET /index.html HTTP/1.1" 200')).pop()
			const match = line?.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}) - /)

			assert.ok(match, `No timestamp in log line: ${line}`)

			const [, day, month, year, hour, minute, second] = match.map(Number)
			const logged = new Date(year, month - 1, day, hour, minute, second).getTime()

			assert.ok(logged >= before - 1000 && logged <= Date.now() + 1000, `Logged time ${new Date(logged).toISOString()} is not close to the request time`)
		})
	})

	describe("--host", () => {
		const external = Object.values(networkInterfaces())
			.flat()
			.find(info => info && info.family === "IPv4" && !info.internal)?.address

		itLogged("listens on all IPv4 addresses by default", () => {
			assert.match(server.getOutput(), new RegExp(`Listening at http://0\\.0\\.0\\.0:${server.port}`))
		})

		itLogged("accepts connections on a non-loopback address by default", { skip: !external && "no non-loopback IPv4 address" }, async () => {
			const { status, body } = await get(server.port, "/index.html", {}, external)

			assert.equal(status, 200)
			assert.equal(body, "<h1>hi</h1>\n")
		})

		itLogged("--host 127.0.0.1 accepts only loopback connections", { skip: !external && "no non-loopback IPv4 address" }, async () => {
			const local = await startServer(["-d", root, "--host", "127.0.0.1"])

			try{
				assert.match(local.getOutput(), new RegExp(`Listening at http://127\\.0\\.0\\.1:${local.port}`))
				assert.equal((await get(local.port, "/index.html")).status, 200)
				await assert.rejects(get(local.port, "/index.html", {}, external), { code: "ECONNREFUSED" })
			}catch(error){
				if(error instanceof Error) error.message += `
--- server output (127.0.0.1) ---
${local.getOutput()}`
				throw error
			}finally{
				await local.stop()
			}
		})
	})

	describe("command line", () => {
		itLogged("exits with an error when the directory does not exist", async () => {
			const result = await new Promise(resolve => {
				const child = spawn(process.execPath, [entry, "0", "-d", join(base, "missing")], { stdio: ["ignore", "pipe", "pipe"] })
				let output = ""

				child.stdout.on("data", chunk => output += chunk)
				child.stderr.on("data", chunk => output += chunk)
				child.on("exit", code => resolve({ code, output }))
			})

			assert.equal(result.code, 1)
			assert.match(result.output, /Directory doesn't exist/)
		})

		itLogged("exits with an error when -d is given without a path", async () => {
			const result = await new Promise(resolve => {
				const child = spawn(process.execPath, [entry, "0", "-d"], { stdio: ["ignore", "pipe", "pipe"] })
				let output = ""

				child.stdout.on("data", chunk => output += chunk)
				child.stderr.on("data", chunk => output += chunk)
				child.on("exit", code => resolve({ code, output }))
			})

			assert.equal(result.code, 1)
			assert.match(result.output, /argument missing/)
		})
	})
})
