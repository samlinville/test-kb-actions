const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

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

  // Check for existing comments
  const existingComments = await octokit.pulls.listReviewComments({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  const commentExists = existingComments.data.some(
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
  const commentBody = `🤖 Beep boop! Heading change detected!

This means that some anchor links pointing to this heading might be broken now.

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

  console.log(`Left comment on ${filePath}:${line}`);
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = parseInt(
    process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER,
    10
  );

  const changedFiles = getChangedFiles();
  for (const filePath of changedFiles) {
    const diff = getFileDiff(filePath);
    const headingChanges = extractHeadingChanges(diff);
    for (const [line, content] of headingChanges) {
      await leaveComment(repo, prNumber, filePath, line, content);
    }
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
