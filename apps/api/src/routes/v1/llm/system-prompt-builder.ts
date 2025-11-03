import type { DocumentContext } from "./types";

export class SystemPromptBuilder {
  private basePrompt: string;

  constructor(basePrompt?: string) {
    this.basePrompt = basePrompt || "You are a helpful AI assistant.";
  }

  build(options: {
    documents?: DocumentContext[];
    tools?: string[];
    customInstructions?: string;
  }): string {
    const sections: string[] = [this.basePrompt];

    // Add document context if provided
    if (options.documents && options.documents.length > 0) {
      sections.push(this.buildDocumentSection(options.documents));
    }

    // Add tool instructions if needed
    if (options.tools && options.tools.length > 0) {
      sections.push(this.buildToolSection(options.tools));
    }

    // Add any custom instructions
    if (options.customInstructions) {
      sections.push(options.customInstructions);
    }

    return sections.join("\n\n");
  }

  private buildDocumentSection(documents: DocumentContext[]): string {
    const docContents = documents
      .map(
        (doc, idx) => `
**Document ${idx + 1}: ${doc.filename}**

${doc.content}

${"---".repeat(20)}`,
      )
      .join("\n\n");

    return `## Reference Documents

You have access to the following documents. Use them to answer questions accurately:

${docContents}

**Important**: The user cannot see these documents. Provide complete, self-contained answers.`;
  }

  private buildToolSection(tools: string[]): string {
    return `## Available Tools

You have access to: ${tools.join(", ")}

Use these tools when needed to help the user.`;
  }
}

