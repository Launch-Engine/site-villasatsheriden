const MONDAY_API_URL = "https://api.monday.com/v2";
const BOARD_ID = "18303887044";

const COLUMN_MAP = {
  email: "email_mkx6583d",
  phone: "phone_mkx64d68",
  comments: "long_text_mkx6m9j1",
  source: "color_mm3ys93h",
  dateSubmitted: "date_mky9ebz7",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiToken = process.env.MONDAY_API_TOKEN;
  if (!apiToken) {
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let firstName, lastName, email, phone, comments;

  try {
    const body = await req.json();
    ({ firstName, lastName, email, phone, comments } = body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!firstName || !email || !phone) {
    return new Response(
      JSON.stringify({ error: "Name, email, and phone are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const fullName = lastName ? `${firstName} ${lastName}` : firstName;
  const today = new Date().toISOString().split("T")[0];

  const columnValues = {
    [COLUMN_MAP.email]: { email, text: email },
    [COLUMN_MAP.phone]: { phone: phone.replace(/\D/g, ""), countryShortName: "US" },
    [COLUMN_MAP.comments]: { text: comments || "" },
    [COLUMN_MAP.source]: { label: "Villas at Sheriden" },
    [COLUMN_MAP.dateSubmitted]: { date: today },
  };

  const mutation = `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
      id
    }
  }`;

  try {
    const resp = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiToken,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          boardId: BOARD_ID,
          itemName: fullName,
          columnValues: JSON.stringify(columnValues),
        },
      }),
    });

    const data = await resp.json();

    if (data.errors || data.error_message) {
      console.error("Monday API errors:", JSON.stringify(data.errors || data.error_message));
      return new Response(
        JSON.stringify({ error: "Failed to submit contact form" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your message has been sent! We'll be in touch soon.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Monday API request failed:", err);
    return new Response(
      JSON.stringify({ error: "Failed to submit contact form" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};
