import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { getDataSource } from ".";
import {
  FilesService,
  PipelinesService,
  ParsingService,
} from "@llamaindex/cloud/api";
import { initService } from "llamaindex/cloud/utils";

const DATA_DIR = "./datasources";

// Load environment variables from local .env.development.local file
dotenv.config({ path: ".env.development.local" });

async function getRuntime(func: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await func();
  const end = Date.now();
  return end - start;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const directory = await fs.opendir(dir);

  for await (const dirent of directory) {
    const entryPath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      yield* walk(entryPath); // Recursively walk through directories
    } else if (dirent.isFile()) {
      yield entryPath; // Yield file paths
    }
  }
}

async function addFileToPipeline(
  projectId: string,
  pipelineId: string,
  uploadFile: File | Blob,
  customMetadata: Record<string, any> = {},
): Promise<void> {
  try {
    console.log(
      `Uploading file: ${uploadFile instanceof File ? uploadFile.name : "unnamed file"}`,
    );
    const file = await FilesService.uploadFileApiV1FilesPost({
      projectId,
      formData: {
        upload_file: uploadFile,
      },
    });
    console.log(`File uploaded successfully. File ID: ${file.id}`);

    // Parse the uploaded file
    let parseResult: {
      parsed_content: string | null;
      metadata: Record<string, any>;
    };
    try {
      console.log(`Parsing file with ID: ${file.id}`);
      // Attempt to use the parsing service
      parseResult = await (ParsingService as any).parseFile({
        projectId,
        requestBody: {
          file_id: file.id,
        },
      });
      console.log(`File parsed successfully`);
    } catch (parseError: unknown) {
      console.warn(
        `Unable to parse file: ${parseError instanceof Error ? parseError.message : "Unknown error"}`,
      );
      parseResult = { parsed_content: null, metadata: {} };
    }

    const files = [
      {
        file_id: file.id,
        custom_metadata: {
          file_id: file.id,
          ...customMetadata,
          parsed_content: parseResult.parsed_content || "",
          metadata: JSON.stringify(parseResult.metadata),
        },
      },
    ];

    console.log(`Adding file to pipeline: ${pipelineId}`);
    await PipelinesService.addFilesToPipelineApiV1PipelinesPipelineIdFilesPut({
      pipelineId,
      requestBody: files,
    });

    console.log(
      `Successfully uploaded and processed file: ${uploadFile instanceof File ? uploadFile.name : "unnamed file"}`,
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error processing file: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    } else {
      console.error(`An unknown error occurred while processing the file`);
    }
    throw error;
  }
}

async function generateDatasource(): Promise<void> {
  const datasource = process.argv[2];
  if (!datasource) {
    console.error("Please provide a datasource as an argument.");
    process.exit(1);
  }

  console.log(`Generating storage context for datasource '${datasource}'...`);

  const ms = await getRuntime(async () => {
    try {
      console.log(`Getting data source for pipeline: ${datasource}`);
      const index = await getDataSource({
        pipeline: datasource,
        ensureIndex: true,
      });
      console.log(`Data source retrieved successfully`);

      const projectId = await index.getProjectId();
      const pipelineId = await index.getPipelineId();
      console.log(`Project ID: ${projectId}, Pipeline ID: ${pipelineId}`);

      // walk through the data directory and upload each file to LlamaCloud
      const dataDir = path.join(DATA_DIR, datasource);
      console.log(`Walking through directory: ${dataDir}`);
      for await (const filePath of walk(dataDir)) {
        console.log(`Processing file: ${filePath}`);
        const buffer = await fs.readFile(filePath);
        const filename = path.basename(filePath);
        const file = new File([buffer], filename);
        await addFileToPipeline(projectId, pipelineId, file, {
          private: "false",
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(`Error generating datasource: ${error.message}`);
        console.error(`Error stack: ${error.stack}`);
      } else {
        console.error(`An unknown error occurred while generating datasource`);
      }
      process.exit(1);
    }
  });
  console.log(
    `Successfully uploaded and processed documents to LlamaCloud in ${ms / 1000}s.`,
  );
}

(async () => {
  try {
    console.log("Initializing service...");
    initService();
    console.log("Service initialized. Starting datasource generation...");
    await generateDatasource();
    console.log("Finished generating storage.");
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`An error occurred: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    } else {
      console.error(`An unknown error occurred`);
    }
    process.exit(1);
  }
})();
