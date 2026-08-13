# Start testing Greenroom

Open `https://greenroom.usespaces.dev/demo` and choose **Organizer**, **Reviewer**, or **Speaker** for one-click access to a predefined account; no inbox, password, or account setup is needed. Use a separate private window or browser profile for each persona so their session cookies do not replace one another. Production currently contains freshly seeded demo data for testing the complete workflow.

The Organizer lands in `/admin` with event-management access, including submissions, review rounds, scheduling, and team administration. The Reviewer also lands in `/admin`, but has a restricted workspace and evaluates only explicitly assigned submissions through round scorecards; reviewers cannot make binding decisions. The Speaker lands in `/portal` and can manage only their own proposals, sessions, and assigned tasks. These accounts share the same demo dataset with other testers, so your changes are visible to others and the data may be reset without notice.
