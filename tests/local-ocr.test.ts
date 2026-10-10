import { access, readFile, stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLocalOcr } from "@/lib/identification/local-ocr";
import { MAX_IMAGE_BYTES } from "@/lib/upload";
import { images, physical } from "./fixtures/runtime-evidence";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: execute,
  }),
}));
beforeEach(() => {
  vi.stubEnv("OCR_PYTHON", "/configured/python");
  vi.stubEnv("OCR_TIMEOUT_MS", "1000");
  vi.stubEnv("USE_MOCK_SERVICES", "false");
  vi.stubEnv("IDENTIFICATION_MODE", "evidence");
  execute
    .mockReset()
    .mockResolvedValue({ stdout: JSON.stringify(physical()), stderr: "" });
});
afterEach(() => vi.unstubAllEnvs());

async function expectCleaned() {
  const paths: string[] = execute.mock.calls[0][1].slice(2);
  for (const path of paths) await expect(access(path)).rejects.toThrow();
}
describe("local OCR CLI bridge (no Python/models)", () => {
  it("writes private ordered bytes, invokes safe argv with limits and cleans up", async () => {
    execute.mockImplementationOnce(async (executable, args, options) => {
      expect(executable).toBe("/configured/python");
      expect(args.slice(0, 2)).toEqual(["-m", "app.services.ocr_cli"]);
      expect(options).toMatchObject({
        timeout: 1000,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      });
      expect(options.cwd).toBe(`${process.cwd()}/vision-service`);
      expect(options.shell).toBeUndefined();
      for (const [index, path] of args.slice(2).entries()) {
        expect(path).toMatch(new RegExp(`image-${index + 1}\\.png$`));
        expect(new Uint8Array(await readFile(path))).toEqual(
          images[index].data,
        );
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
      return { stdout: JSON.stringify(physical()) };
    });
    expect(await runLocalOcr(images)).toMatchObject({
      schema_version: "ocr.v1",
    });
    await expectCleaned();
  });
  it.each([
    [{ signal: "SIGKILL" }, "OCR_TIMEOUT"],
    [{ code: "ENOENT", stderr: "private traceback" }, "OCR_UNAVAILABLE"],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }, "OCR_INVALID_RESPONSE"],
    [
      {
        stderr:
          'diagnostic\n{"error":{"code":"OCR_INFERENCE_FAILED","message":"private details"}}\n',
      },
      "OCR_INFERENCE_FAILED",
    ],
    [{ stderr: '{"error":{"code":"OCR_INVALID_IMAGE"}}' }, "OCR_INVALID_IMAGE"],
  ])("cleans up and maps process failure to %s / %s", async (error, code) => {
    execute.mockRejectedValueOnce(error);
    await expect(runLocalOcr(images)).rejects.toMatchObject({ code });
    await expectCleaned();
  });
  it.each([
    "not json",
    JSON.stringify({ ...physical(), images: [...physical().images].reverse() }),
  ])("rejects malformed or unordered output", async (stdout) => {
    execute.mockResolvedValueOnce({ stdout });
    await expect(runLocalOcr(images)).rejects.toMatchObject({
      code: "OCR_INVALID_RESPONSE",
    });
    await expectCleaned();
  });
  it("requires an explicit absolute Python path", async () => {
    vi.stubEnv("OCR_PYTHON", "python3");
    await expect(runLocalOcr(images)).rejects.toMatchObject({
      code: "OCR_UNAVAILABLE",
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects oversized input before executing", async () => {
    await expect(
      runLocalOcr([
        { mimeType: "image/png", data: new Uint8Array(MAX_IMAGE_BYTES + 1) },
      ]),
    ).rejects.toMatchObject({ code: "OCR_INVALID_INPUT", status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
});
