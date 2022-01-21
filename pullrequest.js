self.addEventListener("message", function (e) {
  cleanPR(pullRequest);

  await ElasticClient.index({
    id: pullRequest.id,
    index: "jstats-pullrequest",
    body: pullRequest,
  });

  // Reviews
  const reviews = await octokit.paginate(
    octokit.rest.pulls.listReviews,
    {
      owner: `${process.env.ORGANIZATION}`,
      repo: repository.name,
      pull_number: pullRequest.number,
      per_page: 100,
    },
    (response) => response.data
  );

  if (reviews.length) {
    reviewCount += reviews.length;
    console.info(reviewCount, `reviews tally`);
  }

  for (const review of reviews) {
    cleanReview(review);

    await ElasticClient.index({
      id: review.id,
      index: "jstats-review",
      body: review,
    });
  }

  // Comments
  const comments = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    {
      owner: `${process.env.ORGANIZATION}`,
      repo: repository.name,
      pull_number: pullRequest.number,
      per_page: 100,
    },
    (response) => response.data
  );

  if (comments.length) {
    commentCount += comments.length;
    console.info(commentCount, `comments tally`);
  }

  for (const comment of comments) {
    cleanComment(comment);

    await ElasticClient.index({
      id: comment.id,
      index: "jstats-comment",
      body: comment,
    });
  }

  self.close();
});

function cleanComment(comment) {
  delete comment?.["_links"];
  delete comment?.["diff_hunk"];
  delete comment?.["html_url"];
  delete comment?.["line"];
  delete comment?.["node_id"];
  delete comment?.["original_line"];
  delete comment?.["original_position"];
  delete comment?.["original_start_line"];
  delete comment?.["position"];
  delete comment?.["pull_request_url"];
  delete comment?.["reactions"];
  delete comment?.["side"];
  delete comment?.["start_line"];
  delete comment?.["start_side"];
  delete comment?.["user"]?.["gravatar_id"];
  delete comment?.["user"]?.["node_id"];
  delete comment?.["user"]?.["site_admin"];
  delete comment?.["user"]?.["type"];
  delete comment?.["user"]?.["url"];

  for (const key in comment?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete comment?.["user"][key];
    }
  }
}

function cleanReview(review) {
  delete review?.["node_id"];
  delete review?.["_links"];
  delete review?.["user"]?.["gravatar_id"];
  delete review?.["user"]?.["node_id"];
  delete review?.["user"]?.["type"];

  for (const key in review?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete review?.["user"][key];
    }
  }
}

function cleanPR(pullRequest) {
  delete pullRequest?.["_links"];
  delete pullRequest?.["active_lock_reason"];
  delete pullRequest?.["diff_url"];
  delete pullRequest?.["merge_commit_sha"];
  delete pullRequest?.["node_id"];

  delete pullRequest?.["base"]?.["repo"];
  delete pullRequest?.["base"]?.["user"];

  delete pullRequest?.["head"]?.["repo"]?.["allow_forking"];
  delete pullRequest?.["head"]?.["repo"]?.["archived"];
  delete pullRequest?.["head"]?.["repo"]?.["created_at"];
  delete pullRequest?.["head"]?.["repo"]?.["disabled"];
  delete pullRequest?.["head"]?.["repo"]?.["fork"];
  delete pullRequest?.["head"]?.["repo"]?.["forks"];
  delete pullRequest?.["head"]?.["repo"]?.["forks_count"];
  delete pullRequest?.["head"]?.["repo"]?.["homepage"];
  delete pullRequest?.["head"]?.["repo"]?.["pushed_at"];
  delete pullRequest?.["head"]?.["repo"]?.["has_issues"];
  delete pullRequest?.["head"]?.["repo"]?.["has_projects"];
  delete pullRequest?.["head"]?.["repo"]?.["has_downloads"];
  delete pullRequest?.["head"]?.["repo"]?.["has_wiki"];
  delete pullRequest?.["head"]?.["repo"]?.["has_pages"];
  delete pullRequest?.["head"]?.["repo"]?.["is_template"];
  delete pullRequest?.["head"]?.["repo"]?.["license"];
  delete pullRequest?.["head"]?.["repo"]?.["node_id"];
  delete pullRequest?.["head"]?.["repo"]?.["open_issues"];
  delete pullRequest?.["head"]?.["repo"]?.["open_issues_count"];
  delete pullRequest?.["head"]?.["repo"]?.["owner"];
  delete pullRequest?.["head"]?.["repo"]?.["size"];
  delete pullRequest?.["head"]?.["repo"]?.["stargazers_count"];
  delete pullRequest?.["head"]?.["repo"]?.["topics"];
  delete pullRequest?.["head"]?.["repo"]?.["updated_at"];
  delete pullRequest?.["head"]?.["repo"]?.["visibility"];
  delete pullRequest?.["head"]?.["repo"]?.["watchers"];
  delete pullRequest?.["head"]?.["repo"]?.["watchers_count"];
  delete pullRequest?.["head"]?.["sha"];
  delete pullRequest?.["head"]?.["user"];

  delete pullRequest?.["user"]?.["gravatar_id"];
  delete pullRequest?.["user"]?.["node_id"];
  delete pullRequest?.["user"]?.["type"];

  delete pullRequest?.["assignee"]?.["gravatar_id"];
  delete pullRequest?.["assignee"]?.["node_id"];
  delete pullRequest?.["assignee"]?.["type"];

  for (const key in pullRequest?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["user"][key];
    }
  }

  for (const key in pullRequest) {
    if (key.search(/_url/) != -1) {
      delete pullRequest[key];
    }
  }

  for (const key in pullRequest?.["assignee"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["assignee"][key];
    }
  }

  for (const assignee in pullRequest?.["assignees"]) {
    for (const key in pullRequest?.["assignees"][assignee]) {
      if (key.search(/_url/) != -1) {
        delete pullRequest?.["assignees"][assignee][key];
      }

      delete pullRequest?.["assignees"][assignee]?.["gravatar_id"];
      delete pullRequest?.["assignees"][assignee]?.["node_id"];
      delete pullRequest?.["assignees"][assignee]?.["type"];
    }
  }

  for (const key in pullRequest?.["head"]?.["repo"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["head"]?.["repo"][key];
    }
  }
}
