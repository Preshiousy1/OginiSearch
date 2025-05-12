import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { DocumentationService } from './documentation.service';

@Controller('docs')
export class DocumentationController {
  constructor(private readonly documentationService: DocumentationService) {}

  @Get()
  async getDocumentationIndex(@Res() res: Response) {
    const files = await this.documentationService.listDocumentationFiles();
    const tutorials = await this.documentationService.getTutorials();

    const html = `
      <html>
        <head>
          <title>Ogini Documentation</title>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
              max-width: 800px; 
              margin: 0 auto; 
              padding: 20px;
              color: #24292e;
              line-height: 1.6;
            }
            h1 { 
              color: #24292e;
              font-size: 2em;
              border-bottom: 1px solid #eaecef;
              padding-bottom: 0.3em;
            }
            h2 {
              color: #24292e;
              font-size: 1.5em;
              border-bottom: 1px solid #eaecef;
              padding-bottom: 0.3em;
              margin-top: 24px;
            }
            .section { 
              margin-bottom: 30px; 
            }
            ul { 
              list-style-type: none; 
              padding: 0; 
            }
            li { 
              margin: 10px 0; 
            }
            a { 
              color: #0366d6; 
              text-decoration: none; 
            }
            a:hover { 
              text-decoration: underline; 
            }
            code {
              font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
              background-color: rgba(27,31,35,0.05);
              padding: 0.2em 0.4em;
              border-radius: 3px;
              font-size: 85%;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 3px;
              padding: 16px;
              overflow: auto;
            }
            pre code {
              background-color: transparent;
              padding: 0;
            }
            blockquote {
              margin: 0;
              padding: 0 1em;
              color: #6a737d;
              border-left: 0.25em solid #dfe2e5;
            }
            table {
              border-spacing: 0;
              border-collapse: collapse;
              margin: 16px 0;
            }
            table th, table td {
              padding: 6px 13px;
              border: 1px solid #dfe2e5;
            }
            table tr {
              background-color: #fff;
              border-top: 1px solid #c6cbd1;
            }
            table tr:nth-child(2n) {
              background-color: #f6f8fa;
            }
          </style>
        </head>
        <body>
          <h1>Ogini Documentation</h1>
          
          <div class="section">
            <h2>Getting Started</h2>
            <ul>
              ${files
                .filter(f => !f.startsWith('tutorials/'))
                .map(
                  file =>
                    `<li><a href="/docs/${file.replace('.md', '')}">${file.replace(
                      '.md',
                      '',
                    )}</a></li>`,
                )
                .join('')}
            </ul>
          </div>

          <div class="section">
            <h2>Tutorials</h2>
            <ul>
              ${tutorials
                .map(
                  file =>
                    `<li><a href="/docs/tutorials/${file.replace('.md', '')}">${file.replace(
                      '.md',
                      '',
                    )}</a></li>`,
                )
                .join('')}
            </ul>
          </div>
        </body>
      </html>
    `;

    res.send(html);
  }

  @Get(':path')
  async getDocumentationFile(@Param('path') path: string, @Res() res: Response) {
    try {
      // Make sure the path ends with .md
      const finalPath = path.endsWith('.md') ? path : `${path}.md`;

      const content = await this.documentationService.getDocumentationFile(finalPath);

      const html = `
        <html>
          <head>
            <title>Ogini Documentation</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                max-width: 800px; 
                margin: 0 auto; 
                padding: 20px;
                color: #24292e;
                line-height: 1.6;
              }
              h1 { 
                color: #24292e;
                font-size: 2em;
                border-bottom: 1px solid #eaecef;
                padding-bottom: 0.3em;
              }
              h2 {
                color: #24292e;
                font-size: 1.5em;
                border-bottom: 1px solid #eaecef;
                padding-bottom: 0.3em;
                margin-top: 24px;
              }
              h3 {
                color: #24292e;
                font-size: 1.25em;
                margin-top: 24px;
              }
              a { 
                color: #0366d6; 
                text-decoration: none; 
              }
              a:hover { 
                text-decoration: underline; 
              }
              .content { 
                line-height: 1.6;
              }
              .back-link { 
                margin-bottom: 20px; 
                display: inline-block;
                color: #0366d6;
              }
              code {
                font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
                background-color: rgba(27,31,35,0.05);
                padding: 0.2em 0.4em;
                border-radius: 3px;
                font-size: 85%;
              }
              pre {
                background-color: #f6f8fa;
                border-radius: 3px;
                padding: 16px;
                overflow: auto;
              }
              pre code {
                background-color: transparent;
                padding: 0;
              }
              blockquote {
                margin: 0;
                padding: 0 1em;
                color: #6a737d;
                border-left: 0.25em solid #dfe2e5;
              }
              table {
                border-spacing: 0;
                border-collapse: collapse;
                margin: 16px 0;
              }
              table th, table td {
                padding: 6px 13px;
                border: 1px solid #dfe2e5;
              }
              table tr {
                background-color: #fff;
                border-top: 1px solid #c6cbd1;
              }
              table tr:nth-child(2n) {
                background-color: #f6f8fa;
              }
              img {
                max-width: 100%;
                box-sizing: border-box;
              }
              hr {
                height: 0.25em;
                padding: 0;
                margin: 24px 0;
                background-color: #e1e4e8;
                border: 0;
              }
            </style>
          </head>
          <body>
            <a href="/docs" class="back-link">← Back to Documentation</a>
            <div class="content">
              ${content}
            </div>
            <script>
              document.addEventListener('DOMContentLoaded', (event) => {
                document.querySelectorAll('pre code').forEach((block) => {
                  hljs.highlightBlock(block);
                });
              });
            </script>
          </body>
        </html>
      `;

      res.send(html);
    } catch (error) {
      const errorHtml = `
        <html>
          <head>
            <title>Documentation Not Found</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 40px 20px;
                text-align: center;
                color: #24292e;
              }
              h1 {
                margin-bottom: 10px;
              }
              p {
                color: #586069;
                font-size: 16px;
              }
              .back-button {
                display: inline-block;
                margin-top: 20px;
                padding: 8px 16px;
                background-color: #0366d6;
                color: white;
                text-decoration: none;
                border-radius: 4px;
              }
              .error-details {
                margin-top: 30px;
                text-align: left;
                background-color: #f6f8fa;
                padding: 15px;
                border-radius: 5px;
                font-family: monospace;
                font-size: 14px;
                color: #586069;
              }
            </style>
          </head>
          <body>
            <h1>Documentation Not Found</h1>
            <p>The requested documentation file could not be found</p>
            <a href="/docs" class="back-button">Back to Documentation</a>
            <div class="error-details">
              <p>Path requested: ${path}</p>
              <p>Error: ${error.message}</p>
            </div>
          </body>
        </html>
      `;

      res.status(404).send(errorHtml);
    }
  }

  @Get('tutorials/:tutorial')
  async getTutorial(@Param('tutorial') tutorial: string, @Res() res: Response) {
    try {
      // Make sure the path ends with .md
      const tutorialPath = tutorial.endsWith('.md')
        ? `tutorials/${tutorial}`
        : `tutorials/${tutorial}.md`;

      const content = await this.documentationService.getDocumentationFile(tutorialPath);

      const html = `
        <html>
          <head>
            <title>Ogini Documentation</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                max-width: 800px; 
                margin: 0 auto; 
                padding: 20px;
                color: #24292e;
                line-height: 1.6;
              }
              h1 { 
                color: #24292e;
                font-size: 2em;
                border-bottom: 1px solid #eaecef;
                padding-bottom: 0.3em;
              }
              h2 {
                color: #24292e;
                font-size: 1.5em;
                border-bottom: 1px solid #eaecef;
                padding-bottom: 0.3em;
                margin-top: 24px;
              }
              h3 {
                color: #24292e;
                font-size: 1.25em;
                margin-top: 24px;
              }
              a { 
                color: #0366d6; 
                text-decoration: none; 
              }
              a:hover { 
                text-decoration: underline; 
              }
              .content { 
                line-height: 1.6;
              }
              .back-link { 
                margin-bottom: 20px; 
                display: inline-block;
                color: #0366d6;
              }
              code {
                font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
                background-color: rgba(27,31,35,0.05);
                padding: 0.2em 0.4em;
                border-radius: 3px;
                font-size: 85%;
              }
              pre {
                background-color: #f6f8fa;
                border-radius: 3px;
                padding: 16px;
                overflow: auto;
              }
              pre code {
                background-color: transparent;
                padding: 0;
              }
              blockquote {
                margin: 0;
                padding: 0 1em;
                color: #6a737d;
                border-left: 0.25em solid #dfe2e5;
              }
              table {
                border-spacing: 0;
                border-collapse: collapse;
                margin: 16px 0;
              }
              table th, table td {
                padding: 6px 13px;
                border: 1px solid #dfe2e5;
              }
              table tr {
                background-color: #fff;
                border-top: 1px solid #c6cbd1;
              }
              table tr:nth-child(2n) {
                background-color: #f6f8fa;
              }
              img {
                max-width: 100%;
                box-sizing: border-box;
              }
              hr {
                height: 0.25em;
                padding: 0;
                margin: 24px 0;
                background-color: #e1e4e8;
                border: 0;
              }
            </style>
          </head>
          <body>
            <a href="/docs" class="back-link">← Back to Documentation</a>
            <div class="content">
              ${content}
            </div>
            <script>
              document.addEventListener('DOMContentLoaded', (event) => {
                document.querySelectorAll('pre code').forEach((block) => {
                  hljs.highlightBlock(block);
                });
              });
            </script>
          </body>
        </html>
      `;

      res.send(html);
    } catch (error) {
      const errorHtml = `
        <html>
          <head>
            <title>Tutorial Not Found</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 40px 20px;
                text-align: center;
                color: #24292e;
              }
              h1 {
                margin-bottom: 10px;
              }
              p {
                color: #586069;
                font-size: 16px;
              }
              .back-button {
                display: inline-block;
                margin-top: 20px;
                padding: 8px 16px;
                background-color: #0366d6;
                color: white;
                text-decoration: none;
                border-radius: 4px;
              }
              .error-details {
                margin-top: 30px;
                text-align: left;
                background-color: #f6f8fa;
                padding: 15px;
                border-radius: 5px;
                font-family: monospace;
                font-size: 14px;
                color: #586069;
              }
            </style>
          </head>
          <body>
            <h1>Tutorial Not Found</h1>
            <p>The requested tutorial file could not be found</p>
            <a href="/docs" class="back-button">Back to Documentation</a>
            <div class="error-details">
              <p>Tutorial requested: ${tutorial}</p>
              <p>Error: ${error.message}</p>
            </div>
          </body>
        </html>
      `;

      res.status(404).send(errorHtml);
    }
  }
}
