import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sendEmail, smtpSettings } from "@/platform/email";

/**
 * SMTP driver (ADR 0023) against a tiny SMTP sink on this machine: what
 * actually goes over the wire, headers included.
 */

type Received = { from: string; to: string[]; data: string };

function smtpSink(): Promise<{
  server: Server;
  port: number;
  inbox: Received[];
}> {
  const inbox: Received[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    let current: Received = { from: "", to: [], data: "" };
    let inData = false;
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          inbox.push(current);
          current = { from: "", to: [], data: "" };
          socket.write("250 queued\r\n");
          continue;
        }
        const line = buffer.indexOf("\r\n");
        if (line === -1) return;
        const command = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        const verb = command.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250 sink\r\n");
        else if (verb === "MAIL") {
          current.from = command;
          socket.write("250 ok\r\n");
        } else if (verb === "RCPT") {
          current.to.push(command);
          socket.write("250 ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port, inbox });
    });
  });
}

const saved = { ...process.env };
let sink: Awaited<ReturnType<typeof smtpSink>>;

beforeAll(async () => {
  sink = await smtpSink();
  Object.assign(process.env, {
    MAIL_DRIVER: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(sink.port),
    SMTP_SECURITY: "none",
    MAIL_FROM: "Almacén <avisos@almacen.test>",
  });
});

afterAll(async () => {
  for (const key of [
    "MAIL_DRIVER",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURITY",
    "MAIL_FROM",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await new Promise((resolve) => sink.server.close(resolve));
});

describe("SMTP driver", () => {
  it("sends the message with sender, reply address and attachment", async () => {
    await sendEmail({
      to: "Proveedor@Example.test",
      subject: "Orden de compra OC-0007",
      text: "Hola:\nAdjuntamos la orden.\nhttps://almacen.test/x",
      replyTo: "compras@cliente.test",
      attachments: [
        {
          name: "OC-0007.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4 prueba"),
        },
      ],
    });
    const mail = sink.inbox.at(-1)!;
    expect(mail.from).toContain("<avisos@almacen.test>");
    expect(mail.to).toEqual(["RCPT TO:<proveedor@example.test>"]);
    expect(mail.data).toMatch(/^From: =\?UTF-8\?.*<avisos@almacen\.test>/m);
    expect(mail.data).toMatch(/^Reply-To: compras@cliente\.test/m);
    expect(mail.data).toMatch(/^Subject: Orden de compra OC-0007/m);
    expect(mail.data).toMatch(/filename="?OC-0007\.pdf"?/);
    expect(mail.data).toContain(
      Buffer.from("%PDF-1.4 prueba").toString("base64"),
    );
  });

  it("refuses a subject with a line break before connecting", async () => {
    const before = sink.inbox.length;
    await expect(
      sendEmail({
        to: "a@example.test",
        subject: "Hola\r\nBcc: otro@example.test",
        text: "x",
      }),
    ).rejects.toThrow("Invalid subject");
    expect(sink.inbox.length).toBe(before);
  });

  it("reports a server that cannot be reached", async () => {
    process.env.SMTP_PORT = "1";
    try {
      await expect(
        sendEmail({ to: "a@example.test", subject: "Hola", text: "x" }),
      ).rejects.toThrow();
    } finally {
      process.env.SMTP_PORT = String(sink.port);
    }
  });
});

describe("SMTP settings", () => {
  const base = {
    SMTP_HOST: "smtp.resend.com",
    SMTP_USER: "resend",
    SMTP_PASSWORD: "secreto",
    MAIL_FROM: "Almacén <avisos@almacen.mx>",
  };

  it("defaults to STARTTLS on port 587", () => {
    expect(smtpSettings(base)).toMatchObject({
      host: "smtp.resend.com",
      port: 587,
      security: "starttls",
      user: "resend",
    });
    expect(smtpSettings({ ...base, SMTP_SECURITY: "tls" }).port).toBe(465);
  });

  it("never sends unencrypted across the network", () => {
    expect(() => smtpSettings({ ...base, SMTP_SECURITY: "none" })).toThrow(
      "only allowed towards localhost",
    );
  });

  it("needs a valid sender and both credentials", () => {
    expect(() => smtpSettings({ ...base, MAIL_FROM: "" })).toThrow("MAIL_FROM");
    expect(() =>
      smtpSettings({ ...base, MAIL_FROM: "Almacén <no es correo>" }),
    ).toThrow("Invalid sender");
    expect(() =>
      smtpSettings({ ...base, MAIL_FROM: "a@b.mx\r\nBcc: c@d.mx" }),
    ).toThrow();
    expect(() => smtpSettings({ ...base, SMTP_PASSWORD: "" })).toThrow(
      "go together",
    );
    expect(() => smtpSettings({ ...base, SMTP_SECURITY: "ssl" })).toThrow(
      "Invalid SMTP_SECURITY",
    );
  });
});
