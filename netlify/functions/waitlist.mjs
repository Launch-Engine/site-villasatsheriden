const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_FILE_URL = "https://api.monday.com/v2/file";
const BOARD_ID = "18416501550";

const COLUMN_MAP = {
  email: "email_mm41arwg",
  phone: "phone_mm41dt18",
  bedrooms: "numeric_mm41gx1v",
  residents: "numeric_mm41yhqr",
  comments: "long_text_mm412wkt",
  source: "text_mm41zf27",
  dateSubmitted: "date_mm41n4z7",
  photoId: "file_mm41h58d",
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

  let name, email, phone, bedrooms, residents, comments, photoFile;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    name = formData.get("name");
    email = formData.get("email");
    phone = formData.get("phone");
    bedrooms = formData.get("bedrooms");
    residents = formData.get("residents");
    comments = formData.get("comments");
    photoFile = formData.get("photoId");
    if (photoFile && photoFile.size === 0) photoFile = null;
  } else {
    try {
      const body = await req.json();
      ({ name, email, phone, bedrooms, residents, comments } = body);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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

    const itemId = data.data.create_item.id;

    if (photoFile) {
      try {
        const fileMutation = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${COLUMN_MAP.photoId}", file: $file) { id } }`;
        const fileForm = new FormData();
        fileForm.append("query", fileMutation);
        fileForm.append("variables[file]", photoFile, photoFile.name);

        const fileResp = await fetch(MONDAY_FILE_URL, {
          method: "POST",
          headers: {
            Authorization: apiToken,
            "API-Version": "2024-10",
          },
          body: fileForm,
        });
        const fileData = await fileResp.json();
        if (fileData.errors) {
          console.error("Monday file upload errors:", JSON.stringify(fileData.errors));
        }
      } catch (fileErr) {
        console.error("File upload failed:", fileErr);
      }
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
