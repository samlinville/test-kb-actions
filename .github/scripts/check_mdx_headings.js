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
  let lineNumber = 0;
  let inHunk = false;
  let hunkStart = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      const match = line.match(/@@ -\d+,\d+ \+(\d+),/);
      hunkStart = match ? parseInt(match[1], 10) : 0;
      lineNumber = hunkStart;
    } else if (inHunk) {
      if (line.startsWith('-') && /^-#+\s/.test(line)) {
        headingChanges.push({ line: lineNumber, content: line });
      }
      if (!line.startsWith('-')) {
        lineNumber++;
      }
    }
  }

  return headingChanges;
}

async function getExistingComments(repo, prNumber) {
  const [owner, repoName] = repo.split('/');
  const { data: comments } = await octokit.pulls.listReviewComments({
    owner,
    repo: repoName,
    pull_number: prNumber,
    per_page: 100,
  });
  return comments;
}

async function createReviewWithComments(
  repo,
  prNumber,
  newComments,
  existingComments
) {
  const [owner, repoName] = repo.split('/');

  console.log(
    `Creating review for PR #${prNumber} with ${newComments.length} comments`
  );

  try {
    // Get the latest commit SHA
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const commitSha = pullRequest.head.sha;

    // Filter out comments that already exist
    const uniqueComments = newComments.filter(
      (newComment) =>
        !existingComments.some(
          (existingComment) =>
            existingComment.path === newComment.path &&
            existingComment.line === newComment.line &&
            existingComment.body.includes(
              'Beep boop! Heading change detected!'
            )
        )
    );

    if (uniqueComments.length === 0) {
      console.log(
        'No new comments to add. Skipping review creation.'
      );
      return;
    }

    // Create a new review with comments
    const { data: review } = await octokit.pulls.createReview({
      owner,
      repo: repoName,
      pull_number: prNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments: uniqueComments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: 'RIGHT',
        body: comment.body,
      })),
    });

    console.log(`Successfully created review with ID: ${review.id}`);
  } catch (error) {
    console.error(`Error creating review: ${error.message}`);
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

  const allComments = [];
  const existingComments = await getExistingComments(repo, prNumber);

  for (const filePath of changedFiles) {
    console.log(`Processing file: ${filePath}`);
    const diff = getFileDiff(filePath);
    const headingChanges = extractHeadingChanges(diff);
    console.log(
      `Heading changes in ${filePath}: ${JSON.stringify(
        headingChanges
      )}`
    );

    for (const change of headingChanges) {
      allComments.push({
        path: filePath,
        line: change.line,
        body: `Beep boop! Heading change detected!

Please search the nextjs/src/app/kb/_content directory for any references to the anchor link for this content, to avoid broken anchor links.

Changed heading: ${change.content}`,
      });
    }
  }

  if (allComments.length > 0) {
    await createReviewWithComments(
      repo,
      prNumber,
      allComments,
      existingComments
    );
  } else {
    console.log(
      'No heading changes detected. No review comments created.'
    );
  }

  console.log('MDX heading check completed.');
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
