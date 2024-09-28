import { NextRequest, NextResponse } from "next/server";
import { uploadDocument } from "@/cl/app/api/chat/llamaindex/documents/upload";
import { getDataSource, parseDataSource } from "../engine";
import { ParsingService } from "@llamaindex/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom upload API to use datasource from request body
export async function POST(request: NextRequest) {
  try {
    const {
      filename,
      base64,
      datasource,
    }: { filename: string; base64: string; datasource: string } =
      await request.json();
    if (!base64 || !datasource) {
      return NextResponse.json(
        { error: "base64 and datasource are required in the request body" },
        { status: 400 },
      );
    }
    const index = await getDataSource(parseDataSource(datasource));
    if (!index) {
      throw new Error(
        `StorageContext is empty - call 'pnpm run generate ${datasource}' to generate the storage first`,
      );
    }

    // Upload the document
    const uploadResult = await uploadDocument(index, filename, base64);

    if (!Array.isArray(uploadResult) || uploadResult.length === 0) {
      throw new Error("Upload failed: No document ID returned");
    }

    const documentId = uploadResult[0];

    // Parse the uploaded file
    let parseResult;
    try {
      parseResult = await (ParsingService as any).parseFile({
        projectId: await index.getProjectId(),
        requestBody: {
          file_id: documentId,
        },
      });
    } catch (parseError: unknown) {
      console.warn(
        `Unable to parse file: ${parseError instanceof Error ? parseError.message : "Unknown error"}`,
      );
      parseResult = { parsed_content: null, metadata: {} };
    }

    // Combine upload result with parse result
    const result = {
      id: documentId,
      parsed_content: parseResult.parsed_content,
      metadata: parseResult.metadata,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Upload API]", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
