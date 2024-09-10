import { execSync } from 'child_process';
import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: {
    fetch: fetch,
  },
});

function getChangedFiles() {
  const result = execSync('git diff --name-only origin/main...HEAD')
    .toString()
    .trim();
  return result
    .split('\n')
    .filter(
      (file) =>
        file.startsWith('nextjs/src/app/kb/_content/') &&
        file.endsWith('.mdx')
    );
}

function getFileDiff(filePath) {
  return execSync(
    `git diff origin/main...HEAD -- "${filePath}"`
  ).toString();
}

function extractHeadingChanges(diff) {
  const lines = diff.split('\n');
  const headingChanges = [];
  let currentLine = 0;

  for (const line of lines) {
    currentLine++;
    if (line.startsWith('-') && /^-#+\s/.test(line)) {
      headingChanges.push([currentLine, line]);
    }
  }

  return headingChanges;
}

async function leaveComment(repo, prNumber, filePath, line, content) {
  const [owner, repoName] = repo.split('/');

  console.log(
    `Attempting to leave comment on ${filePath}:${line} for PR #${prNumber}`
  );

  try {
    // Check for existing comments
    const { data: existingComments } =
      await octokit.pulls.listReviewComments({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

    const commentExists = existingComments.some(
      (comment) =>
        comment.path === filePath &&
        comment.position === line &&
        comment.body.includes('Beep boop! Heading change detected!')
    );

    if (commentExists) {
      console.log(`Comment already exists for ${filePath}:${line}`);
      return;
    }

    // Get the latest commit SHA
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const commitSha = pullRequest.head.sha;

    // Create a new comment with the updated format
    const commentBody = `Beep boop! Heading change detected!

Please search the nextjs/src/app/kb/_content directory for any references to the anchor link for this content, to avoid broken anchor links.`;

    await octokit.pulls.createReviewComment({
      owner,
      repo: repoName,
      pull_number: prNumber,
      body: commentBody,
      commit_id: commitSha,
      path: filePath,
      position: line,
    });

    console.log(`Successfully left comment on ${filePath}:${line}`);
  } catch (error) {
    console.error(`Error leaving comment: ${error.message}`);
    console.error(`Status: ${error.status}`);
    console.error(`Request URL: ${error.request?.url}`);
    console.error(
      `Response data: ${JSON.stringify(error.response?.data)}`
    );
  }
}

async function main() {
  console.log('Starting MDX heading check...');

  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = parseInt(
    process.env.GITHUB_EVENT_NUMBER ||
      process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER,
    10
  );

  console.log(`Repository: ${repo}`);
  console.log(`Pull Request Number: ${prNumber}`);

  if (isNaN(prNumber)) {
    console.error('Invalid pull request number. Exiting.');
    process.exit(1);
  }

  const changedFiles = getChangedFiles();
  console.log(`Changed files: ${JSON.stringify(changedFiles)}`);

  for (const filePath of changedFiles) {
    console.log(`Processing file: ${filePath}`);
    const diff = getFileDiff(filePath);
    const headingChanges = extractHeadingChanges(diff);
    console.log(
      `Heading changes in ${filePath}: ${JSON.stringify(
        headingChanges
      )}`
    );
    for (const [line, content] of headingChanges) {
      await leaveComment(repo, prNumber, filePath, line, content);
    }
  }

  console.log('MDX heading check completed.');
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
