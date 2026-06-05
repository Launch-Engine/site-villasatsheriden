const MONDAY_API_URL = "https://api.monday.com/v2";
const BOARD_ID = "18416501550";

const COLUMN_MAP = {
  email: "email_mm41arwg",
  phone: "phone_mm41dt18",
  bedrooms: "numeric_mm41gx1v",
  residents: "numeric_mm41yhqr",
  comments: "long_text_mm412wkt",
  source: "text_mm41zf27",
  dateSubmitted: "date_mm41n4z7",
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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { name, email, phone, bedrooms, residents, comments } = body;

  if (!name || !email || !phone) {
    return new Response(
      JSON.stringify({ error: "Name, email, and phone are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const columnValues = {
    [COLUMN_MAP.email]: { email, text: email },
    [COLUMN_MAP.phone]: { phone, countryShortName: "US" },
    [COLUMN_MAP.bedrooms]: String(bedrooms || ""),
    [COLUMN_MAP.residents]: String(residents || ""),
    [COLUMN_MAP.comments]: { text: comments || "" },
    [COLUMN_MAP.source]: "Villas at Sheriden Website",
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
          itemName: name,
          columnValues: JSON.stringify(columnValues),
        },
      }),
    });

    const data = await resp.json();

    if (data.errors || data.error_message) {
      console.error("Monday API errors:", JSON.stringify(data.errors || data.error_message));
      return new Response(
        JSON.stringify({ error: "Failed to submit waitlist entry" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "You have been added to the waitlist!",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Monday API request failed:", err);
    return new Response(
      JSON.stringify({ error: "Failed to submit waitlist entry" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};
