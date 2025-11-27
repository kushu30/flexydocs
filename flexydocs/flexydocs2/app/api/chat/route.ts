import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: Request) {
  const raw = await request.text();
  console.log("RAW REQUEST BODY:", raw);

  let body: any = {};
  try {
    body = JSON.parse(raw);
  } catch {}

  let userInput = "";

  if (body.messages && Array.isArray(body.messages)) {
    const last = body.messages[body.messages.length - 1];
    if (last.parts && last.parts[0] && last.parts[0].text) {
      userInput = last.parts[0].text;
    }
  }

  if (!userInput.trim()) {
    return new Response(JSON.stringify({ error: "empty input" }), { status: 400 });
  }

  const docs = await fetch("http://localhost:3000/llms-full.txt").then(r => r.text());

  const prompt = `You are a documentation assistant.
Rules:
1. Answer only from documentation.
2. If not in documentation, reply: "This is not in documentation."
3. Use simple language.
4. Guide users to correct menus or pages.
5. When referencing any path, always output it as a Markdown link: [/path](/path)
User question: ${userInput}

Documentation:
${docs}
`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

  const result = await model.generateContent(prompt);
  const output = result.response.text();

  console.log("GEMINI RESPONSE:", output);

  const encoder = new TextEncoder();
  const messageId = crypto.randomUUID();

  function sseEvent(obj: any) {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseEvent({ type: 'start', messageId })));
      controller.enqueue(encoder.encode(sseEvent({ type: 'text-start', id: messageId })));

      const chunkSize = 512;
      for (let i = 0; i < output.length; i += chunkSize) {
        const delta = output.slice(i, i + chunkSize);
        controller.enqueue(encoder.encode(sseEvent({ type: 'text-delta', id: messageId, delta })));
      }

      controller.enqueue(encoder.encode(sseEvent({ type: 'text-end', id: messageId })));
      controller.enqueue(encoder.encode(sseEvent({ type: 'finish' })));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
