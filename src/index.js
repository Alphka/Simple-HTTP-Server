#!/usr/bin/env node

const { join, normalize, basename, parse, isAbsolute, resolve } = require("path")
const { name: _name, version, description } = require("../package.json")
const { readdirSync, existsSync, statSync } = require("fs")
const { program } = require("commander")
const { URL } = require("url")
const express = require("express")
const mime = require("mime")

const name = "Simple HTTP Server"
const template = join(__dirname, "template.pug")
const app = express()

app.locals.pretty = true

app.disable("x-powered-by")
app.disable("etag")

program.name(name)
program.description(description)
program.version(version)

function isNumber(number){
	if(number === 0) return true
	if(!number) return false
	if(!["string", "number"].includes(typeof number)) return false

	number = Number(number)

	return Number.isFinite(number) && !Number.isNaN(number)
}

/** @param {number} number */
function addZero(number){
	return number < 10 ? "0" + number : number.toString()
}

/** @param {string | number | Date} [value] */
function GetFormattedDate(value){
	const date = value ? new Date(value) : new Date()
	const day = date.getDate()
	const month = date.getMonth() + 1
	const year = date.getFullYear()
	const hour = date.getHours()
	const min = date.getMinutes()
	const ms = Math.round(date.getMilliseconds() / 10)

	const dateString = [day, month, year].map(addZero).join("/")
	const timeString = [hour, min, ms].map(addZero).join(":")

	return dateString + " " + timeString
}

/** @param {string} path */
function MimeType(path){
	const { ext, name } = parse(path)
	const text = "text/plain; charset=utf-8"
	const stream = "application/octet-stream"
	const typescript = "application/typescript"

	if(!ext){
		if(/^license$/i.test(name)) return text
		return stream
	}

	if(name === ".editorconfig") return text

	if(path.endsWith(".ts")){
		if(path.endsWith(".d.ts")) return typescript

		if(existsSync(path)){
			const { size } = statSync(path)
			return size >= 2**20 ? mime.lookup(path) : typescript
		}else return typescript
	}

	const suggested = mime.lookup(path, stream)

	if(path.endsWith(".js")) return suggested + "; charset=utf-8"

	return /^text\/[^; ]+$/.test(suggested) ? suggested + "; charset=utf-8" : suggested
}

program.option("-d, --directory [path]", "Specify alternative directory", process.cwd())
program.argument("[port]", "Specify alternate port", 8000)

program.action(async (port, { directory }) => {
		port = isNumber(port) ? Number(port) : 8000

		if(directory){
			directory = isAbsolute(directory) ? normalize(directory) : resolve(process.cwd(), directory)
			directory = directory.replace(/"$/, "")

			if(!existsSync(directory)){
				directory = directory.replace(/`\[/g, "[").replace(/`]/g, "]")
				if(!existsSync(directory)) return program.error("Directory doesn't exist: " + directory)
			}
		}else directory = process.cwd()

		app.get("*", (request, response) => {
			/**
			 * @param {number} status Response status
			 * @param {string} [error] Request error message
			 * @param {string | boolean} [range] Requested range
			 */
			function LogMessage(status, error, range){
				const { ip, url, method, httpVersion, headers } = request
				const { "user-agent": userAgent } = headers
				const date = GetFormattedDate()

				let message = `${ip} - ${date} - ${userAgent} - "${method} ${url} HTTP/${httpVersion}" ${status ?? null}`

				if(range && typeof range === "string") message += ` Range: ${range}`

				if(error){
					response.statusCode = status
					response.end()
					console.error(`${message} (${error})`)
					return
				}

				console.log(message)
			}

			const url = new URL(request.url, `http://${request.header("host")}`)
			const urlPath = decodeURIComponent(url.pathname).replace(/\/+$/, "/")
			const path = join(directory, urlPath.substring(1))

			if(!existsSync(path)) return LogMessage(404, "Path does not exist")

			const stats = statSync(path)
			const isDirectory = stats.isDirectory()

			if(isDirectory){
				response.render(template, {
					directory: urlPath,
					files: readdirSync(path).map(name => {
						const stat = statSync(join(path, name))
						return stat.isDirectory() ? name + "/" : name
					})
				})
			}else{
				const mimeType = MimeType(path)
				const isStream = mimeType === "application/octet-stream"

				response.sendFile(path, {
					acceptRanges: stats.size > 3 * 2**20,
					lastModified: false,
					cacheControl: false,
					dotfiles: "allow",
					headers: {
						"Access-Control-Allow-Methods": "GET",
						"Content-Type": mimeType,
						"Content-Disposition": `inline; filename="${encodeURIComponent(basename(path))}"`,
						"Cache-Control": isStream ? "no-transform" : "public, max-age=3600",
						"Last-Modified": new Date(stats.mtime).toUTCString()
					}
				})
			}

			LogMessage(response.statusCode || 200, undefined, isDirectory && request.header("range")?.split?.("=").pop())
		})

		app.use(/** @type {express.ErrorRequestHandler} */ (error, request, response, next) => {
			/**
			 * @param {number} status Response status
			 * @param {string} [error] Request error message
			 * @param {string | boolean} [range] Requested range
			 */
			function LogMessage(status, error, range){
				const { ip, url, method, httpVersion } = request
				const date = GetFormattedDate()

				let message = `${ip} - ${date} - "${method} ${url} HTTP/${httpVersion}" ${status ?? null}`

				if(range && typeof range === "string") message += ` Range: ${range}`

				if(error){
					response.statusCode = status
					response.end()
					console.error(`${message} (${error})`)
					return
				}

				console.log(message)
			}

			if(response.headersSent){
				response.end()
				return console.log(error)
			}

			if(error instanceof Error){
				const { status, message } = error
				LogMessage(status, message)
				response.status(status)
				response.end()
			}else if(typeof error === "number"){
				response.status(error)
				response.end()
			}else next(error)
		})

		const server = app.listen(port)

		server.on("listening", () => console.log(`Listening at ${port}`))
		server.on("error", console.error)
	})

program.parse()
