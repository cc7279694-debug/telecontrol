import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const appScheme = "app";
const appHost = "host";
const allowedMethods = new Set(["GET", "HEAD"]);

type SchemeRegistrar = {
  registerSchemesAsPrivileged: (
    schemes: Array<{
      scheme: string;
      privileges: {
        secure: boolean;
        standard: boolean;
        supportFetchAPI: boolean;
      };
    }>,
  ) => void;
};

type ProtocolHandler = (request: Request) => Promise<Response>;

type ProtocolInstaller = {
  handle: (scheme: string, handler: ProtocolHandler) => void;
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isInsideRoot(rendererRoot: string, candidatePath: string) {
  const relativePath = path.relative(rendererRoot, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function getFileResponse(filePath: string, method: string) {
  const body = await readFile(filePath);
  const headers = new Headers({
    "content-length": String(body.byteLength),
    "content-type":
      contentTypes[path.extname(filePath).toLowerCase()] ??
      "application/octet-stream",
  });

  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

async function isFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function registerAppScheme(protocolModule: SchemeRegistrar) {
  protocolModule.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export function createAppProtocolHandler(
  rendererRoot: string,
): ProtocolHandler {
  const absoluteRendererRoot = path.resolve(rendererRoot);

  return async (request) => {
    if (!allowedMethods.has(request.method)) {
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const requestUrl = new URL(request.url);
    if (
      requestUrl.protocol !== `${appScheme}:` ||
      requestUrl.hostname !== appHost
    ) {
      return new Response(null, { status: 403 });
    }

    if (
      requestUrl.pathname.includes("%") ||
      requestUrl.pathname.includes("\\")
    ) {
      return new Response(null, { status: 400 });
    }

    const relativePath =
      requestUrl.pathname.replace(/^\/+/, "") || "index.html";
    const segments = relativePath.split("/");
    if (
      segments.some(
        (segment) => segment === "." || segment === ".." || segment === "",
      )
    ) {
      return new Response(null, { status: 400 });
    }

    const candidatePath = path.resolve(absoluteRendererRoot, ...segments);
    if (!isInsideRoot(absoluteRendererRoot, candidatePath)) {
      return new Response(null, { status: 403 });
    }

    if (await isFile(candidatePath)) {
      const [realRendererRoot, realCandidatePath] = await Promise.all([
        realpath(absoluteRendererRoot),
        realpath(candidatePath),
      ]);

      if (!isInsideRoot(realRendererRoot, realCandidatePath)) {
        return new Response(null, { status: 403 });
      }

      return getFileResponse(realCandidatePath, request.method);
    }

    if (path.extname(relativePath) !== "") {
      return new Response(null, { status: 404 });
    }

    const indexPath = path.join(absoluteRendererRoot, "index.html");
    if (!(await isFile(indexPath))) {
      return new Response(null, { status: 404 });
    }

    return getFileResponse(indexPath, request.method);
  };
}

export function installAppProtocol(
  protocolModule: ProtocolInstaller,
  rendererRoot: string,
) {
  protocolModule.handle(appScheme, createAppProtocolHandler(rendererRoot));
}
