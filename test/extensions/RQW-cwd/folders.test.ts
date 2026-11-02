import assert from "node:assert/strict";
import { it } from "node:test";
import { isSystemFolder } from "../../../extensions/RQW-cwd/folders.ts";

it("macOS matches only the disk root, the home folder and its Downloads, exactly", () => {
	const home = "/Users/tester";
	for (const cwd of ["/", home, `${home}/`, `${home}/Downloads`, `${home}/Downloads/`]) assert.equal(isSystemFolder(cwd, "darwin", home), true, cwd);
	for (const cwd of ["/Users", `${home}/Downloads/work`, `${home}/Documents`, `${home}/project`, `${home}/downloads`, "/tmp"]) {
		assert.equal(isSystemFolder(cwd, "darwin", home), false, cwd);
	}
});

it("Windows matches its six folders without case, separator or trailing-separator differences", () => {
	const home = "C:\\Users\\Tester";
	const matches = ["C:\\", "c:/", "C:\\Users\\", "c:/users", "C:\\Users\\tester", "C:/Users/Tester/Downloads/", "C:\\PROGRAM FILES", "c:\\windows\\"];
	for (const cwd of matches) assert.equal(isSystemFolder(cwd, "win32", home), true, cwd);
	const others = ["C:\\Users\\Tester\\Downloads\\x", "C:\\Users\\Tester\\Documents", "C:\\Windows\\System32", "C:\\Program Files (x86)", "D:\\", "C:\\work"];
	for (const cwd of others) assert.equal(isSystemFolder(cwd, "win32", home), false, cwd);
});

it("other systems have no system folders", () => {
	assert.equal(isSystemFolder("/", "linux", "/home/tester"), false);
	assert.equal(isSystemFolder("/home/tester", "linux", "/home/tester"), false);
});
