import { build, cards } from "./build.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import Handlebars from "npm:handlebars";
import { extname } from "https://deno.land/std@0.224.0/path/extname.ts";

const watcher = Deno.watchFs(["cards/", "site/"]);
const RE_REFRESH_WS = /\/_r$/;

Handlebars.registerHelper("eq", (a, b) => a == b);

const sockets: Set<WebSocket> = new Set();

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const filePath = `dist${url.pathname}`;
  if (RE_REFRESH_WS.test(req.url)) {
    const upgrade = Deno.upgradeWebSocket(req);
    upgrade.socket.onclose = () => {
      sockets.delete(upgrade.socket);
    };
    sockets.add(upgrade.socket);
    return upgrade.response;
  }

  if (`${filePath}` == "dist/") {
    // read template from site/index.hbs
    const template = Handlebars.compile(
      await Deno.readTextFile(join(Deno.cwd(), "site/index.hbs")),
    );

    const cardsData = await cards();

    return new Response(
      template({
        cards: [...cardsData.entries()].map(([key, card]) => {
          return { key, ...card.data };
        }),
        environment: "development",
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      },
    );
  }
  try {
    const file = await Deno.readFile(filePath);
    const ext = extname(filePath).slice(1);
    return new Response(file, {
      status: 200,
      headers: {
        "content-type": {
          css: "text/css",
          png: "image/png",
          html: "text/html",
          json: "application/json",
        }[ext] ?? "text/plain",
      },
    });
  } catch (e) {
    if (
      e instanceof Deno.errors.NotFound || e instanceof Deno.errors.IsADirectory
    ) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(`Internal Server Error\n\n${e}`, { status: 500 });
  }
};

(async () => {
  let queued = null;
  async function send() {
    queued = null;
    console.log("Building...");
    await build();
    console.log("Refreshing...");
    sockets.forEach((socket) => {
      try {
        socket.send("");
      } catch {
        // ignore
      }
    });
  }

  for await (const event of watcher) {
    if (event.kind === "access") {
      continue;
    }
    console.log("File change detected:", event);
    if (queued !== null) {
      clearTimeout(queued);
    }
    queued = setTimeout(send, 100);
  }
})();

console.log("HTTP webserver running. Access it at: http://localhost:9898/");
Deno.serve({ port: 9898 }, handler);