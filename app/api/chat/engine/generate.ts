import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { getDataSource } from ".";
import {
  ApiError,
  FilesService,
  PipelinesService,
  EmbeddingConfigType,
  PipelineType,
} from "@llamaindex/cloud/api";
import { initService } from "llamaindex/cloud/utils";
import { OpenAIEmbedding, Settings } from "llamaindex";

const DATA_DIR = "./datasources";

// Load environment variables from local .env.development.local file
dotenv.config({ path: ".env.development.local" });

// Debug logging for environment variables
console.log("Debug: Environment Variables");
console.log("LLAMA_CLOUD_BASE_URL:", process.env.LLAMA_CLOUD_BASE_URL);
console.log("LLAMA_CLOUD_PROJECT_NAME:", process.env.LLAMA_CLOUD_PROJECT_NAME);
console.log(
  "LLAMA_CLOUD_ORGANIZATION_ID:",
  process.env.LLAMA_CLOUD_ORGANIZATION_ID,
);
console.log("API Key is set:", !!process.env.LLAMA_CLOUD_API_KEY);

// Set up the embedding model globally
Settings.embedModel = new OpenAIEmbedding({
  model: "text-embedding-3-small",
});

async function getRuntime(func: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await func();
  const end = Date.now();
  return end - start;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const directory = await fs.opendir(dir);
  for await (const dirent of directory) {
    if (dirent.name.startsWith(".")) continue; // Skip hidden files and directories
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
  filePath: string,
  customMetadata: Record<string, any> = {},
  retries = 3,
): Promise<void> {
  try {
    console.log(`Uploading file: ${path.basename(filePath)}`);
    const fileContent = await fs.readFile(filePath);
    const file = await FilesService.uploadFileApiV1FilesPost({
      projectId,
      formData: {
        upload_file: new Blob([fileContent], {
          type: "application/octet-stream",
        }),
      },
    });
    console.log(`File uploaded successfully. File ID: ${file.id}`);

    const files = [
      {
        file_id: file.id,
        custom_metadata: {
          file_id: file.id,
          ...customMetadata,
        },
      },
    ];

    console.log(`Adding file to pipeline: ${pipelineId}`);
    await PipelinesService.addFilesToPipelineApiV1PipelinesPipelineIdFilesPut({
      pipelineId,
      requestBody: files,
    });

    console.log(
      `Successfully uploaded and processed file: ${path.basename(filePath)}`,
    );
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 400 && retries > 0) {
      console.warn(
        `Bad request when adding file to pipeline. Retrying... (${retries} attempts left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second before retrying
      return addFileToPipeline(
        projectId,
        pipelineId,
        filePath,
        customMetadata,
        retries - 1,
      );
    }
    if (error instanceof Error) {
      console.error(`Error processing file: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    } else {
      console.error(`An unknown error occurred while processing the file`);
    }
    // Instead of throwing the error, we'll log it and continue with the next file
    console.log(`Skipping file due to error: ${path.basename(filePath)}`);
  }
}

async function generateDatasource(): Promise<void> {
  const datasource = process.argv[2];
  if (!datasource) {
    throw new Error("Please provide a datasource name as an argument.");
  }

  console.log(`Generating storage context for datasource '${datasource}'...`);

  const ms = await getRuntime(async () => {
    try {
      const index = await getDataSource({ pipeline: datasource });
      const projectId = await index.getProjectId();
      console.log(`Project ID: ${projectId}`);

      // List existing pipelines
      const pipelines = await PipelinesService.searchPipelinesApiV1PipelinesGet(
        {
          projectId,
        },
      );
      console.log(`Found ${pipelines.length} pipelines`);

      // Find or create the pipeline
      let pipeline = pipelines.find((p) => p.name === datasource);
      if (!pipeline) {
        console.log(
          `Pipeline '${datasource}' not found. Creating a new pipeline.`,
        );
        const newPipeline = {
          name: datasource,
          pipeline_type: PipelineType.MANAGED,
          embedding_config: {
            type: EmbeddingConfigType.OPENAI_EMBEDDING,
            model_name: "text-embedding-ada-002",
          },
        };
        console.log(
          `Debug: Create Pipeline Request Body: ${JSON.stringify(newPipeline, null, 2)}`,
        );
        pipeline = await PipelinesService.createPipelineApiV1PipelinesPost({
          projectId,
          requestBody: newPipeline,
        });
        console.log(`Created new pipeline with ID: ${pipeline.id}`);
      }

      if (!pipeline) {
        throw new Error(`Failed to create or find pipeline: ${datasource}`);
      }
      const pipelineId = pipeline.id;
      console.log(`Pipeline ID: ${pipelineId}`);

      // Walk through the data directory and upload each file to LlamaCloud
      const dataDir = path.join(DATA_DIR, datasource);
      console.log(`Walking through directory: ${dataDir}`);
      for await (const filePath of walk(dataDir)) {
        console.log(`Processing file: ${filePath}`);
        await addFileToPipeline(projectId, pipelineId, filePath, {
          private: "false",
        });
      }
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        console.error(`Error generating datasource: ${error.message}`);
        console.error(`Error details: ${JSON.stringify(error.body)}`);
      } else if (error instanceof Error) {
        console.error(`Error generating datasource: ${error.message}`);
        console.error(`Error stack: ${error.stack}`);
      } else {
        console.error(`An unknown error occurred while generating datasource`);
      }
      throw error;
    }
  });

  console.log(`Finished processing documents for LlamaCloud in ${ms / 1000}s.`);
}

(async () => {
  try {
    console.log("Initializing service...");
    initService({
      apiKey: process.env.LLAMA_CLOUD_API_KEY,
      baseUrl: process.env.LLAMA_CLOUD_BASE_URL,
    });
    console.log("Service initialized. Starting datasource generation...");
    await generateDatasource();
    console.log("Finished generating storage.");
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      console.error(`An error occurred: ${error.message}`);
      console.error(`Error details: ${JSON.stringify(error.body)}`);
    } else if (error instanceof Error) {
      console.error(`An error occurred: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    } else {
      console.error(`An unknown error occurred`);
    }
    process.exit(1);
  }
})();
