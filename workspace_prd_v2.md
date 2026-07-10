  
**PRODUCT REQUIREMENTS DOCUMENT**

**Real Estate Brokerage Workspace Platform**

Multi-Tenant SaaS on MERN Stack  |  Two-Phase Delivery Plan

| Document Version | 2.0 — Phased Release Plan |
| :---- | :---- |
| **Status** | Ready for Development |
| **Stack** | MongoDB · Express.js · React · Node.js |
| **Deployment** | Multi-Tenant SaaS — Subdomain per Brokerage |
| **Phase 1 Scope** | Broker \+ Agent core — Intranet & Communications |
| **Phase 2 Scope** | TC role, Transaction Management, Analytics, Groups |
| **Date** | March 12, 2026 |

*CONFIDENTIAL — INTERNAL USE ONLY*

| 1\. Executive Summary |
| :---- |

This document defines the complete product requirements for a multi-tenant SaaS real estate brokerage intranet and workspace platform, built on the MERN stack (MongoDB, Express.js, React, Node.js). The platform is delivered in two distinct phases.

Phase 1 establishes the core brokerage digital headquarters — the features that serve brokers and agents first. This includes the internal communications infrastructure, resource management, task assignment, shared calendar, homepage dashboard, and banner advertising tools. Phase 1 is a complete, shippable product. Brokerages can operate on Phase 1 indefinitely.

Phase 2 expands the platform to handle deal management and external collaboration — adding the Transaction Coordinator role, full transaction lifecycle management, compliance document workflows, external party access, team engagement analytics, and group-based targeting. Phase 2 builds on Phase 1's architecture without requiring refactoring.

Each subscribing brokerage operates in a branded, isolated environment accessible at their own subdomain (e.g., acmerealty.platform.com). The platform serves multiple user roles across both phases, with the data model and auth system designed from day one to accommodate all roles — even those not activated until Phase 2\.

| 2\. Phase Overview & Feature Map |
| :---- |

The table below defines which features ship in each phase. Phase 1 features are fully specified in Section 5\. Phase 2 features are specified at requirements level in Section 6\. Developers should not build Phase 2 features during Phase 1 — however, the data model and API structure should be designed to accommodate them without future refactoring.

| Feature / Module | Phase | Priority |
| :---- | :---- | :---- |
| Multi-Tenant Infrastructure (subdomain routing, data isolation) | **Phase 1** | Core |
| Authentication & Session Management | **Phase 1** | Core |
| Role-Based Access Control (Broker/Owner \+ Agent active) | **Phase 1** | Core |
| Homepage Dashboard (configurable widgets) | **Phase 1** | Core |
| Activity Feed (internal events \+ RSS) | **Phase 1** | Core |
| Message Board & Announcements | **Phase 1** | Core |
| Shared Calendar (office events, agent personal events) | **Phase 1** | Core |
| Banner Ads (scheduled, targeted, click-tracked) | **Phase 1** | Core |
| Resource Hub (file library, categories, versioning) | **Phase 1** | Core |
| Task Management (assign, track, complete, templates) | **Phase 1** | Core |
| User Management & Agent Onboarding | **Phase 1** | Core |
| In-App & Email Notifications | **Phase 1** | Core |
| Admin Panel (full Phase 1 config) | **Phase 1** | Core |
| Transaction Coordinator Role | **Phase 2** | Extended |
| Transaction Management (full lifecycle) | **Phase 2** | Extended |
| Compliance Checklists & Document Workflows | **Phase 2** | Extended |
| Document Versioning & External Party Access | **Phase 2** | Extended |
| Team Engagement Analytics & Insights Dashboard | **Phase 2** | Extended |
| Groups (targeted comms & tasks) | **Phase 2** | Extended |
| eSignature Integration (external provider link) | **Phase 2** | Extended |

| 3\. Users & Roles |
| :---- |

Six user roles exist across both phases. The role system is built in full during Phase 1 — all six roles are defined in the data model, auth middleware, and permission checks. However, only Broker/Owner, Office Admin, and Agent roles are activated and usable in Phase 1\. Transaction Coordinator and External roles are enabled in Phase 2\. Super Admin is a platform-level role active from day one.

| Role | Description | Phase |
| :---- | :---- | :---- |
| **Super Admin** | Platform-level administrator (your team). Manages tenant provisioning, billing, and platform-wide settings. Does not interact with brokerage content. | **Phase 1** |
| **Broker / Owner** | Top-level brokerage administrator. Full read/write access to all brokerage content. Configures the platform, manages users, and controls all admin settings. | **Phase 1** |
| **Office Admin** | Day-to-day operations manager. Creates content, manages resources, assigns tasks, configures banners, and supports onboarding. Cannot modify billing or subscription. | **Phase 1** |
| **Agent** | Standard brokerage member. Accesses feed, calendar, resource hub, and task list. In Phase 2, opens and manages their own transactions. | **Phase 1** |
| **Transaction Coord. (TC)** | Manages transactions on behalf of assigned agents. Elevated transaction access but no intranet admin access. | **Phase 2** |
| **External (Client/Vendor)** | Invited external party. Access restricted to a specific transaction workspace only. No intranet access. | **Phase 2** |

| *Architecture note: All six roles must be defined as enum values in the User schema during Phase 1 development. Phase 2 features gate on these roles — retrofitting the role system later creates unnecessary refactoring risk.* |
| :---- |

| 4\. Multi-Tenant Architecture |
| :---- |

### **4.1 Tenant Isolation Model**

Each brokerage is a Tenant document in MongoDB. Every other document in the database carries a tenantId field. All API queries are scoped to the authenticated user's tenantId by middleware — no query executes without this filter. Cross-tenant data access must be architecturally impossible at the query layer, not just the application layer.

### **4.2 Subdomain Routing**

* Each tenant is assigned a unique subdomain slug at registration (e.g., 'acmerealty').

* Incoming requests to acmerealty.platform.com resolve by reading the subdomain from the Host header and looking up the corresponding Tenant document.

* If no matching tenant is found, return a 404 with a branded 'Brokerage not found' page.

* The platform root domain serves only the marketing site and Super Admin panel.

* Wildcard DNS (\*.platform.com) must be configured to point all subdomains to the server.

### **4.3 Tenant Configuration Document**

The Tenant document stores all brokerage-level configuration. Editable only by Broker/Owner:

* brandName — brokerage display name

* logoUrl — uploaded logo stored in object storage

* primaryColor — hex color applied as UI accent across the brokerage workspace

* subdomainSlug — unique identifier used for subdomain routing

* rssFeeds — array of RSS feed URLs (max 10\) for the Activity Feed

* officeLocations — array of office objects: { name, address, timezone } for multi-office support

* subscriptionStatus — active | trialing | pastDue | cancelled

* onboardingTaskTemplateId — references the Task Template automatically assigned to new users

### **4.4 Authentication**

* Session-based authentication using express-session with connect-mongo for MongoDB session persistence.

* Passwords hashed using Node.js crypto.scrypt. Plaintext passwords are never stored or logged.

* Session payload includes: userId, tenantId, role. All protected routes validate all three.

* Invitation flow: new users register via a tokenized invite link (valid 7 days). Token is stored as a hashed value in the Invitations collection.

* Cloudflare Turnstile bot protection on registration and login forms.

* MongoDB sliding window rate limiting on all public auth endpoints.

### **4.5 Tech Stack**

| Item | Detail |
| :---- | :---- |
| **Runtime** | Node.js LTS |
| **Backend** | Express.js |
| **Database** | MongoDB Atlas with Mongoose ODM |
| **Frontend** | React with Vite |
| **Auth** | express-session \+ connect-mongo, crypto.scrypt |
| **Validation** | Zod — applied to all API request bodies before business logic |
| **File Storage** | S3-compatible object storage (AWS S3 or Cloudflare R2) |
| **Email** | Resend with HTML template literals |
| **Rate Limiting** | MongoDB-backed sliding window rate limiter |
| **Error Tracking** | Sentry (backend \+ frontend) |
| **Analytics** | PostHog |
| **Logging** | pino |
| **CI/CD** | GitHub \+ GitHub Actions |
| **Hosting** | Render — single service, Express serves built React SPA |
| **Bot Protection** | Cloudflare Turnstile on public forms |

| 5\. Phase 1 — Feature Specifications |
| :---- |

All features in this section are fully specified and development-ready. Phase 1 is a complete, shippable product upon delivery of all features below. Nothing in this section is optional for Phase 1 launch.

| PHASE 1 — Ship in V1 |
| :---- |

## **5.1 Homepage Dashboard**

### **5.1.1 Purpose**

The homepage is the first screen every authenticated user sees after login. It is the brokerage's digital front door — surfacing relevant news, upcoming events, active announcements, and quick-access links. The broker controls the layout and content of this screen.

### **5.1.2 Functional Requirements**

* The homepage renders a configurable widget layout. Broker/Owner enables, disables, and reorders widgets from the Admin Panel.

* Available widgets in Phase 1: Activity Feed preview (latest 5 items), Upcoming Calendar Events (next 5), Pinned Announcements (latest 3), Quick Links, Banner Ad slot, Welcome Message block, and My Tasks summary (open task count \+ next due).

* Welcome Message: a rich-text block authored by the Broker. Supports bold, italic, and hyperlinks. Displayed prominently on the homepage.

* Quick Links: Broker configures labeled hyperlinks (internal or external) that render as button-style tiles.

* The layout is the same for all users within a tenant. Content within widgets is filtered by the user's office assignment and role.

* Branding: the homepage header displays the brokerage logo and name from Tenant config. The primaryColor field is applied as the accent color for buttons, active states, and headings across the entire UI.

* New users who have not completed their onboarding task list see an Onboarding Progress bar on their homepage until all onboarding tasks are marked complete.

| PHASE 1 — Ship in V1 |
| :---- |

## **5.2 Activity Feed**

### **5.2.1 Purpose**

The Activity Feed surfaces a chronological stream of brokerage news and internal events. It replaces agents having to check email, social groups, and news sites separately to stay informed.

### **5.2.2 Functional Requirements**

* Two content types: Internal Activity (system-generated events) and External News (RSS feeds configured by Broker).

* Internal Activity events include: announcement posted, task assigned, new resource uploaded, agent joined brokerage, task completed (your own), calendar event created. Each event renders as a human-readable string with timestamp and a link to the relevant entity.

* External News: Broker/Owner configures up to 10 RSS feed URLs in Tenant Settings. A background job fetches and caches feed items every 60 minutes. Cached items are stored in the RssItems MongoDB collection. Feed renders from the database — never fetched live on page load.

* Feed is paginated — 20 items per page with infinite scroll.

* Users can filter by: All, Internal Only, External News Only.

* Broker/Owner can pin an internal item to the top of all agents' feeds for up to 7 days.

* Clicking a feed item navigates to the relevant resource, task, or announcement.

| Item | Detail |
| :---- | :---- |
| **RSS Poll Interval** | Every 60 minutes via node-cron background job |
| **Max RSS Feeds** | 10 per tenant |
| **Internal Events Retained** | 90 days |
| **RSS Items Retained** | 30 days |
| **Page Size** | 20 items, infinite scroll |

| PHASE 1 — Ship in V1 |
| :---- |

## **5.3 Message Board & Announcements**

### **5.3.1 Purpose**

The Message Board is the primary internal communications channel. It replaces mass email for announcements, policy updates, and brokerage news. Unlike email, it is a permanent, searchable record that new hires can review retroactively.

### **5.3.2 Functional Requirements**

* Broker/Owner and Office Admin create posts. Agents read posts and optionally comment (commenting toggled per post by the author).

* Posts support rich text: bold, italic, bullet lists, numbered lists, hyperlinks, and image attachments (uploaded to object storage).

* Targeting: posts can be directed to All Users or a specific Office. Phase 2 adds Group targeting.

* Pinning: posts can be pinned to the top of the Message Board and the Pinned Announcements homepage widget (max 3 pinned at any time).

* Scheduling: posts can be set to publish at a future datetime via a publishAt field.

* Notifications: agents receive an in-app notification when a post targeting them is published. Email notification sent for posts marked as 'Important'.

* Search: the Message Board is keyword-searchable. Scope is limited to the authenticated user's tenant.

* Archive: posts are retained indefinitely and accessible via search and direct URL.

* Comments are flat (one level). Comments can be deleted by the author or by Office Admin / Broker/Owner.

| PHASE 1 — Ship in V1 |
| :---- |

## **5.4 Shared Calendar**

### **5.4.1 Purpose**

The Shared Calendar is the brokerage's coordination hub — a single source of truth for office events, training sessions, compliance deadlines, and agent availability. It replaces disconnected calendar invites sent over email and gives the broker operational visibility into what is happening across the team at any given time.

### **5.4.2 Functional Requirements**

* Calendar renders in Month, Week, and Day views. Default view is Month.

* Office Events: Broker/Owner and Office Admin create events visible to all users or targeted to a specific Office. Office Events appear on every targeted user's calendar.

* Personal Events: Agents create events visible only to themselves. These are private scheduling blocks.

* Event fields: title, description (rich text), start datetime, end datetime, all-day toggle, location (text), recurrence (none, daily, weekly, monthly, custom), RSVP enabled/disabled.

* RSVP: when enabled, agents can respond Yes / No / Maybe. The event creator sees a response summary panel.

* Resource Reservation: Office Events can be tagged with a brokerage resource (e.g., 'Conference Room A', 'Training Room'). Broker/Owner defines reservable resources in Admin Panel. Only one event can hold a resource at any given time — the calendar enforces this with a conflict check on save.

* Reminders: users opt into email reminders at 24 hours and 1 hour before events they are attending.

* Mandatory Events: Broker/Owner can mark an Office Event as mandatory. Mandatory events render with a visual indicator and appear in the Activity Feed as a notification to all targeted agents.

* Phase 1 explicitly does not include Google Calendar or Outlook sync. External calendar integration is deferred to a future release.

| *The resource reservation feature is what turns the calendar from a passive communication tool into an active coordination tool — agents can see room availability without emailing the front desk.* |
| :---- |

| PHASE 1 — Ship in V1 |
| :---- |

## **5.5 Banner Ads**

### **5.5.1 Purpose**

Banner Ads are high-visibility content blocks displayed at the top of the homepage. They communicate urgent, time-sensitive, or high-priority information — upcoming deadlines, new programs, agent recognition, or partner promotions. Because the UI is designed with banner slots from the start, they integrate cleanly into the homepage layout without retrofitting.

### **5.5.2 Functional Requirements**

* Broker/Owner and Office Admin create and manage Banner Ads from the Admin Panel.

* Banner Ad fields: image upload (stored in object storage, recommended 1200x300px) OR rich text block, optional CTA button with label and URL, target audience (All Users or specific Office), start date, end date.

* A maximum of 3 active banners display at any time. If more than 3 are active and scheduled, they rotate on a 5-second interval.

* Click-through tracking: every banner click is logged (bannerId, userId, timestamp). Click counts are visible to Broker/Owner in the Admin Panel banner management view.

* Expired banners are automatically hidden but remain in the admin list. They can be duplicated and rescheduled.

* The homepage layout reserves a dedicated banner slot regardless of whether any active banners exist — the slot simply collapses gracefully when empty.

| Item | Detail |
| :---- | :---- |
| **Max Simultaneous Banners** | 3 (rotates if more are scheduled) |
| **Rotation Interval** | 5 seconds |
| **Image Dimensions** | Recommended 1200x300px, max 5MB |
| **Audience Targeting Phase 1** | All Users or specific Office |
| **Group Targeting** | Phase 2 (requires Groups feature) |

| PHASE 1 — Ship in V1 |
| :---- |

## **5.6 Resource Hub**

### **5.6.1 Purpose**

The Resource Hub is the brokerage's centralized asset library. It gives agents instant self-service access to every marketing template, brand guideline, compliance form, training document, and script they need — replacing the combination of email attachments, shared drives, and verbal handoffs that most brokerages rely on. The Broker controls what is available, who can see it, and what version is current.

### **5.6.2 Functional Requirements**

* Resources are organized into Categories and Sub-Categories. Broker/Owner and Office Admin manage category structure from the Admin Panel.

* Each resource is either a file upload (any file type, stored in S3-compatible object storage) or an external URL link.

* Resource record fields: title, description, category, subcategory, fileUrl or externalUrl, fileType, uploadedBy, tenantId, targetAudience, createdAt, updatedAt.

* Target Audience Phase 1: All Users or specific Office. Phase 2 adds Group targeting.

* Agents see only resources they are authorized to access based on office assignment.

* Search: keyword search on title and description. Filter by category and file type.

* Download tracking: every file download is logged (userId, resourceId, timestamp) for future use by the Phase 2 Insights Dashboard.

* Resource versioning: uploading a replacement file creates a new version. Prior versions are archived and accessible to Broker/Owner from the resource detail view. Agents always see the current version only.

* Featured Resources: Broker/Owner marks up to 6 resources as Featured. These render as a prominent tile row at the top of the Resource Hub page.

* Bookmarks: agents can bookmark resources for quick access from a personal 'My Resources' view within the hub.

| Item | Detail |
| :---- | :---- |
| **Max File Size** | 50MB per upload |
| **Category Depth** | 2 levels: Category \+ Sub-Category |
| **Featured Resources** | Max 6 at any time |
| **Version History** | All prior versions retained indefinitely |
| **Group Targeting** | Phase 2 |

| PHASE 1 — Ship in V1 |
| :---- |

## **5.7 Task Management**

### **5.7.1 Purpose**

Task Management allows Brokers and Admins to assign action items to individuals, offices, or all agents — and track completion without chasing people individually. The system handles the follow-up loop: agents see their open tasks every time they log in, and the broker sees who is done and who is not without sending a single email.

### **5.7.2 Functional Requirements**

* Task creation: Broker/Owner and Office Admin only. Agents can view and complete tasks assigned to them.

* Task fields: title, description (rich text), assignees, dueDate, priority (High / Medium / Low), attachments (up to 5 files, 25MB each), relatedResource (optional link to a Resource Hub item).

* Assignee targets Phase 1: individual users, specific Office, or All Users. Phase 2 adds Group targeting.

* Assignee resolution: when assigned to an Office or All Users, individual completion records are created for each member at time of assignment. Members added after task creation are not automatically included.

* My Tasks: agents see all open tasks assigned to them in a 'My Tasks' panel on the homepage dashboard and in a dedicated Tasks page in the navigation.

* Completion: agents mark a task complete via a completion button. An optional completion note can be submitted.

* Recurring tasks: tasks can recur on a schedule (daily, weekly, monthly). On the recurrence date, a new task instance is created and assigned to the same audience.

* Notifications: in-app notification on task assignment. Email notification for High priority tasks or tasks due within 48 hours. Reminder notification 24 hours before due date for incomplete tasks.

* Overdue indicator: tasks past due date display a visual overdue badge in the agent's task list.

* Task Templates: Broker/Owner saves a task configuration as a reusable template. Used for onboarding checklists, license renewal flows, and recurring compliance items.

| Item | Detail |
| :---- | :---- |
| **Who Creates Tasks** | Broker/Owner, Office Admin |
| **Who Completes Tasks** | Assigned user (or Admin on their behalf) |
| **Max Attachments** | 5 files, 25MB each |
| **Recurring Options** | Daily, Weekly, Monthly |
| **Task History** | Retained 2 years |
| **Group Assignment** | Phase 2 |

| PHASE 1 — Ship in V1 |
| :---- |

## **5.8 User Management & Onboarding**

### **5.8.1 Agent Invitation Flow**

* Broker/Owner and Office Admin invite new agents by entering their email address and assigning role, office.

* System sends an invitation email (via Resend) with a tokenized signup link valid for 7 days. Token is stored hashed in the Invitations collection.

* The invite link pre-fills tenant context so the new user registers directly into the correct brokerage workspace.

* Expired invitations can be resent from the User Management panel.

* On first login, new users are prompted to complete their profile: display name, phone number, and profile photo upload.

### **5.8.2 Structured Onboarding**

* When a new user is invited, the Onboarding Task Template configured in Admin Settings is automatically assigned to them.

* The new user's homepage displays an Onboarding Progress bar (percentage of tasks completed) until all onboarding tasks are done.

* Broker/Owner can see onboarding completion status per new agent from the User Management panel.

### **5.8.3 User Profile & Directory**

* Each user has a profile page visible to all users in the tenant: display name, photo, role, office, contact info, and optional bio.

* Users edit their own profile. Broker/Owner and Office Admin can edit any user's profile.

* A User Directory page lists all active users with search by name and filter by office and role.

### **5.8.4 Deactivation**

* Broker/Owner and Office Admin can deactivate a user. Deactivated users cannot log in.

* Deactivation does not delete data. All user content, activity history, and task completion records are retained.

* Deactivated user accounts remain searchable in the admin User Management panel with a 'Deactivated' status indicator.

| PHASE 1 — Ship in V1 |
| :---- |

## **5.9 Notification System**

### **5.9.1 Delivery Channels**

| Item | Detail |
| :---- | :---- |
| **In-App** | Bell icon in navigation header with unread count. Clicking opens a notification drawer listing recent notifications with timestamps and links. |
| **Email** | Sent via Resend for high-priority or time-sensitive events. Users manage email preferences in profile settings. |

### **5.9.2 Phase 1 Notification Triggers**

* Task assigned to user

* Task due in 24 hours (if incomplete)

* Task overdue

* Important announcement published and targeting user

* New resource uploaded to a category user has bookmarked

* Invitation accepted (notifies the inviting admin)

* Mandatory calendar event created targeting user

### **5.9.3 User Preferences**

* Users configure which triggers generate email vs. in-app only from their Profile Settings page.

* In-app notifications cannot be fully disabled.

* Task overdue email notifications cannot be disabled.

| PHASE 1 — Ship in V1 |
| :---- |

## **5.10 Admin Panel**

### **5.10.1 Purpose**

The Admin Panel is the control center for the brokerage workspace, accessible only to Broker/Owner and Office Admin roles. It is accessed via a persistent Admin link in the navigation sidebar, visible only to qualifying roles.

### **5.10.2 Phase 1 Admin Panel Sections**

* Brokerage Settings — Edit brandName, logo, primaryColor, office locations, RSS feed URLs.

* User Management — View all users (active and deactivated), invite new users, edit roles and office assignments, deactivate accounts, view onboarding status.

* Homepage Layout — Enable, disable, and reorder homepage widgets. Configure the Welcome Message block.

* Banner Ads — Create, schedule, edit, and manage banner ads. View click-through counts.

* Resource Hub Management — Manage categories and sub-categories. Upload, edit, version, archive, and delete resources. Manage Featured Resources list.

* Task Templates — Create, edit, and delete reusable task configurations.

* Onboarding Configuration — Select or configure the onboarding task template assigned to new users automatically.

* Notification Settings — Configure which platform events trigger email notifications brokerage-wide.

| 6\. Phase 2 — Feature Specifications |
| :---- |

Features in this section are not built during Phase 1\. They are documented at a requirements level so the developer understands what is coming and designs Phase 1 architecture to accommodate them. No Phase 2 feature should be partially implemented in Phase 1 — features are either fully built or fully deferred.

| PHASE 2 — Deferred to V2 |
| :---- |

## **6.1 Transaction Coordinator (TC) Role**

The TC role is activated in Phase 2\. TCs are assigned to one or more agents and manage transactions on their behalf. They have full read/write access to all transactions belonging to their assigned agents, but no access to intranet admin features (Resource Hub management, Announcements creation, Task creation, etc.).

* TC users are invited via the same invitation flow as agents.

* Broker/Owner assigns agents to a TC from the User Management panel.

* TC dashboard surfaces all open transactions across their assigned agents as their primary view.

| PHASE 2 — Deferred to V2 |
| :---- |

## **6.2 Transaction Management**

### **6.2.1 Transaction Lifecycle Stages**

| Item | Detail |
| :---- | :---- |
| **Draft** | Agent opened a transaction but has not submitted for broker review. |
| **Submitted** | Agent submitted. Awaiting broker/admin review. |
| **Under Review** | Office Admin or Broker reviewing documents for compliance. |
| **Active** | Compliant and proceeding toward close. Milestone dates tracked. |
| **Closing** | Within 7 days of closing date. Heightened dashboard visibility. |
| **Closed** | Transaction closed. Documents archived. Edits require unlock. |
| **Cancelled** | Transaction terminated. Reason logged. Documents archived. |

### **6.2.2 Core Requirements**

* Agent opens a transaction and enters: property address, client(s), transaction type, list price/sale price, commission, and key dates (offer, acceptance, option period, inspection, financing deadline, closing).

* The appropriate compliance checklist template is auto-applied based on transaction type (configured by Broker in Admin Panel).

* Transaction cannot advance from Submitted to Under Review unless all mandatory checklist items have an uploaded document.

* Transaction cannot advance from Under Review to Active unless all mandatory checklist items are marked Approved by Office Admin or Broker.

* All state-changing actions generate an immutable timeline entry.

* Key dates feed automatically into the shared calendar as read-only entries for the responsible agent and assigned TC.

### **6.2.3 Compliance Checklists**

* Broker/Owner configures Checklist Templates in Admin Panel. Templates are named lists of required document items with mandatory/optional flags.

* Checklist item statuses: Pending, Uploaded, Approved, Rejected. Rejected items require a rejection reason visible to the agent.

### **6.2.4 Document Management**

* Documents uploaded to S3-compatible object storage. Served via signed URLs with 15-minute expiry.

* Document version history tracked per checklist item. Prior versions accessible to Broker/Owner.

* Bulk ZIP download available for all documents in a transaction.

### **6.2.5 eSignature**

* Native eSignature is not built. A configurable external eSignature URL per tenant (e.g., Authentisign or DocuSign) is surfaced as a launch button within the transaction. Completed signature documents are manually uploaded back into the document panel.

### **6.2.6 External Party Access**

* Agent/Broker invites external parties (clients, title company, lender) by email.

* System sends a magic link (tokenized URL, valid 72 hours) to the external party.

* External party sees a read-only transaction view showing only explicitly shared documents.

* External parties can upload documents to designated upload slots.

* Access revocable at any time by agent or admin.

| PHASE 2 — Deferred to V2 |
| :---- |

## **6.3 Team Engagement & Insights Dashboard**

The Insights Dashboard gives Broker/Owner real-time operational visibility into agent engagement and transaction pipeline. It reads from precomputed daily rollups — not live aggregation queries. Phase 1 already logs engagement events (logins, downloads, task completions, banner clicks) to the EngagementEvents collection in anticipation of this feature.

### **6.3.1 Dashboard Panels**

* Active Users — Count of users logged in within 7 and 30 days with trend line.

* Agent Engagement Table — Sortable by last login, login count, tasks completed, resources downloaded. Disengaged agents (no login in 14+ days) flagged visually.

* Resource Usage — Ranked list of most-downloaded resources in the past 30 days.

* Announcement Reach — For each post: targeted user count vs. view count as percentage.

* Task Completion Rate — Per task: completion count vs. total assigned.

* Transaction Pipeline — Open transaction count by stage.

| *Architecture note for Phase 1: The EngagementEvents collection must be created and events logged during Phase 1 development even though the dashboard is not built yet. Logging login events, resource downloads, task completions, and banner clicks in Phase 1 ensures the Phase 2 dashboard has historical data from day one.* |
| :---- |

| PHASE 2 — Deferred to V2 |
| :---- |

## **6.4 Groups**

Groups are named collections of users used for targeted communications, task assignment, and resource access. They allow Brokers to segment the agent roster beyond the built-in office and role structure — for example, 'Commercial Division', 'New Agents', or 'Team Leads'.

* Created and managed by Broker/Owner and Office Admin.

* Used as targeting audiences in: Announcements, Banner Ads, Tasks, and Resource Hub visibility.

* A user can belong to multiple Groups simultaneously.

* Deleting a Group does not affect existing content — records retain a snapshot of group membership at time of creation.

| 7\. Data Model |
| :---- |

The following table lists all MongoDB collections for the complete platform (both phases). Phase 1 builds the core collections. Phase 2 adds or extends collections as noted. Every document except Tenants includes a tenantId field. All queries must filter by tenantId enforced at the middleware layer.

| Item | Detail |
| :---- | :---- |
| **Tenants** | One document per brokerage. All configuration fields. Phase 1\. |
| **Users** | All user accounts. Role, officeId, tenantId, hashedPassword, profile. Phase 1\. |
| **Sessions** | Managed by connect-mongo. Phase 1\. |
| **Invitations** | Pending invite tokens (stored hashed), expiresAt, role, officeId. Phase 1\. |
| **Posts** | Message Board posts. Rich text body, targetAudience, isPinned, publishAt. Phase 1\. |
| **Comments** | Flat comment threads on Posts. Phase 1\. |
| **RssItems** | Cached RSS feed entries per tenant. Written by background job. Phase 1\. |
| **CalendarEvents** | Office and personal events. Recurrence rules, RSVP responses. Phase 1\. |
| **Banners** | Banner configurations with schedule dates, click tracking. Phase 1\. |
| **Resources** | Resource Hub items. S3 URL, category, version history array. Phase 1\. |
| **Categories** | Resource Hub category \+ sub-category definitions per tenant. Phase 1\. |
| **Tasks** | Task records with per-assignee completion sub-documents. Phase 1\. |
| **TaskTemplates** | Reusable task configurations. Phase 1\. |
| **Notifications** | In-app notification records per user. isRead flag. Phase 1\. |
| **EngagementEvents** | Raw event log: login, pageView, download, taskComplete, bannerClick. Phase 1 (logs events; dashboard built Phase 2). |
| **Groups** | Named user groups with memberIds array. Phase 2\. |
| **Transactions** | Full transaction lifecycle documents. Nested: keyDates, checklistItems, documents, notes, timeline, sharedWith. Phase 2\. |
| **Clients** | Buyer/seller records. Can be associated with multiple transactions. Phase 2\. |
| **MagicLinks** | Temporary external party access tokens. transactionId, email, expiresAt, revokedAt. Phase 2\. |
| **DailyStats** | Precomputed engagement rollups per tenant. Written by background job. Phase 2\. |

| 8\. API Structure |
| :---- |

All routes are prefixed /api/v1. All routes except /auth/\* require an active authenticated session. Tenant context is resolved from the session and applied by middleware — it is never passed in the request body. Phase column indicates when the endpoint is built.

| Item | Detail |
| :---- | :---- |
| **POST /auth/login** | Phase 1 — Accepts email \+ password. Returns session cookie. |
| **POST /auth/logout** | Phase 1 — Destroys session. |
| **POST /auth/register** | Phase 1 — Accepts invitation token. Creates user account. |
| **POST /auth/magic-link/:token** | Phase 2 — Validates external party magic link. Returns limited-scope session. |
| **GET /users** | Phase 1 — List all users in tenant. Office Admin+ only. |
| **POST /users/invite** | Phase 1 — Send invitation email. Office Admin+ only. |
| **GET /users/:id** | Phase 1 — Get user profile. |
| **PATCH /users/:id** | Phase 1 — Update profile or role. Auth required. |
| **DELETE /users/:id** | Phase 1 — Deactivate user. Office Admin+ only. |
| **GET /posts** | Phase 1 — List Message Board posts visible to user. |
| **POST /posts** | Phase 1 — Create announcement. Office Admin+ only. |
| **PATCH /posts/:id** | Phase 1 — Edit post. Author or Admin only. |
| **DELETE /posts/:id** | Phase 1 — Delete post. Office Admin+ only. |
| **POST /posts/:id/comments** | Phase 1 — Add comment. Agent+. |
| **DELETE /posts/:id/comments/:commentId** | Phase 1 — Delete comment. Author or Admin. |
| **GET /feed** | Phase 1 — Aggregated activity feed. Paginated. |
| **GET /events** | Phase 1 — Calendar events visible to user. |
| **POST /events** | Phase 1 — Create event. Agent+ (scoped by role). |
| **PATCH /events/:id** | Phase 1 — Edit event. Creator or Admin only. |
| **DELETE /events/:id** | Phase 1 — Delete event. Creator or Admin only. |
| **POST /events/:id/rsvp** | Phase 1 — Submit RSVP response. |
| **GET /banners** | Phase 1 — Active banners targeted to user. |
| **POST /banners** | Phase 1 — Create banner. Office Admin+ only. |
| **PATCH /banners/:id** | Phase 1 — Edit banner. Office Admin+ only. |
| **DELETE /banners/:id** | Phase 1 — Delete banner. Office Admin+ only. |
| **POST /banners/:id/click** | Phase 1 — Record banner click-through event. |
| **GET /resources** | Phase 1 — List resources accessible to user. |
| **POST /resources** | Phase 1 — Upload resource. Office Admin+ only. |
| **PATCH /resources/:id** | Phase 1 — Edit resource metadata. Office Admin+ only. |
| **DELETE /resources/:id** | Phase 1 — Delete resource. Office Admin+ only. |
| **GET /resources/:id/download** | Phase 1 — Stream file via signed URL. Logs download event. |
| **POST /resources/:id/bookmark** | Phase 1 — Bookmark a resource. |
| **GET /tasks** | Phase 1 — List tasks assigned to user. |
| **POST /tasks** | Phase 1 — Create task. Office Admin+ only. |
| **PATCH /tasks/:id** | Phase 1 — Edit task. Creator or Admin only. |
| **PATCH /tasks/:id/complete** | Phase 1 — Mark task complete. Assignee only. |
| **GET /notifications** | Phase 1 — In-app notifications for user. |
| **PATCH /notifications/:id/read** | Phase 1 — Mark notification read. |
| **PATCH /notifications/read-all** | Phase 1 — Mark all notifications read. |
| **GET /admin/settings** | Phase 1 — Tenant configuration. Broker/Owner only. |
| **PATCH /admin/settings** | Phase 1 — Update tenant configuration. Broker/Owner only. |
| **GET /groups** | Phase 2 — List groups. Office Admin+ only. |
| **POST /groups** | Phase 2 — Create group. Office Admin+ only. |
| **PATCH /groups/:id** | Phase 2 — Edit group membership. Office Admin+ only. |
| **DELETE /groups/:id** | Phase 2 — Delete group. Broker/Owner only. |
| **GET /transactions** | Phase 2 — List transactions (scoped by role). |
| **POST /transactions** | Phase 2 — Open new transaction. |
| **PATCH /transactions/:id/stage** | Phase 2 — Advance transaction stage. Role-gated. |
| **POST /transactions/:id/documents** | Phase 2 — Upload document. |
| **PATCH /transactions/:id/checklist/:itemId** | Phase 2 — Approve or reject checklist item. |
| **POST /transactions/:id/invite** | Phase 2 — Invite external party. Sends magic link. |
| **GET /insights/summary** | Phase 2 — Engagement summary. Office Admin+ only. |
| **GET /insights/agents** | Phase 2 — Per-agent engagement table. Office Admin+ only. |

| 9\. Non-Functional Requirements |
| :---- |

### **9.1 Security**

* All routes enforce session authentication. No protected data is returned to unauthenticated requests under any condition.

* All database queries are tenant-scoped by middleware. Cross-tenant data access is architecturally impossible at the query layer.

* Zod schema validation on all incoming request bodies before any business logic executes. Invalid requests return 400 with a structured error response.

* File upload endpoints validate file type and size before writing to object storage.

* Rate limiting on all public endpoints via MongoDB-backed sliding window limiter.

* Cloudflare Turnstile on registration and login forms.

* Passwords hashed via crypto.scrypt. Plaintext passwords never stored or logged.

* Invitation and magic link tokens are cryptographically random (crypto.randomBytes), stored hashed, and have explicit expiry timestamps.

* Object storage documents are served via signed URLs with 15-minute expiry — not permanent public URLs.

### **9.2 Performance**

* Dashboard, resource hub, and feed page loads must complete within 2 seconds on standard broadband.

* All list endpoints are paginated. Default page size 20\. Maximum page size 100\.

* RSS feed content served from MongoDB cache — never from live HTTP fetches on page load.

* Phase 2 Insights Dashboard reads from precomputed DailyStats — never from live aggregation on the EngagementEvents collection.

* File downloads stream from object storage. The Express server does not buffer file contents in memory.

### **9.3 Reliability**

* Sentry integrated on both Express backend and React frontend for error tracking.

* Background jobs (RSS polling, recurring task creation, Phase 2 DailyStats rollup) use a persistent job queue with retry logic — max 3 retries before moving to dead-letter log.

* Database connection failures handled gracefully — return 503 with user-facing error message.

### **9.4 Scalability**

* Session state stored in MongoDB (not in-process memory) — multiple Node.js instances can serve the same tenant.

* MongoDB indexes must be defined on all query filter fields: tenantId, userId, role, stage, targetAudience, createdAt, dueDate, expiresAt.

* Binary assets stored in object storage. No files stored on the Express server's filesystem.

### **9.5 Accessibility**

* All interactive UI elements are keyboard-navigable.

* Color contrast meets WCAG 2.1 AA standards.

* All functional images and icons have appropriate alt text or aria-label attributes.

| 10\. Phase 1 — Explicitly Out of Scope |
| :---- |

The following are not built in Phase 1\. The developer should not implement these items partially or speculatively during Phase 1 development. Full specifications are in Section 6\.

* Transaction Management workflows (lifecycle, checklists, compliance, document versioning)

* Transaction Coordinator role (defined in schema, not activated in Phase 1 UI or access control)

* External party access (client/vendor magic link, transaction-scoped guest accounts)

* Team Engagement Analytics Dashboard (events are logged in Phase 1 but the dashboard is not built)

* Groups feature (targeted comms and tasks beyond Office-level in Phase 1\)

* eSignature integration (external provider link)

* Google Calendar or Outlook sync

* Native mobile application (responsive web only)

* Commission tracking or back-office accounting

* AI-generated content or recommendations

* Two-factor authentication

* Public-facing agent websites or IDX property search

| 11\. Open Questions — Decisions Required Before Development |
| :---- |

The following require a decision from the product owner before or early in development. The developer should not make unilateral assumptions on these items.

1. Subscription Billing: How is tenant billing managed? Will Stripe be used for brokerage subscription payments in Phase 1? If yes, what are the plan tiers and do any Phase 1 features gate on plan level?

2. Super Admin Console: Does the Super Admin console need to be built in Phase 1, or can tenant provisioning be handled manually during early customer acquisition?

3. Multi-Office Agents: Can an agent belong to more than one office within the same brokerage? If yes, how does content targeting (announcements, banners, resources) behave — does the agent see content from all their offices?

4. Post Moderation: When commenting is enabled on an announcement, are comments posted immediately with retroactive deletion available, or do they require admin approval before appearing?

5. Agent Leaderboard: Is the optional Leaderboard homepage widget in scope for Phase 1? If yes, what metric does it rank on?

6. Timezone Handling: Are all datetime fields stored in UTC and converted to the user's local timezone on the frontend, or is the tenant's configured timezone the canonical reference?

7. Document Retention: Is there a maximum retention period for archived documents and engagement events, or are they retained indefinitely?

8. Calendar Resource Reservation: The PRD includes room/resource reservation on the calendar. Confirm this is in scope for Phase 1 or flag if it should defer to Phase 2\.

*End of Document — Real Estate Brokerage Workspace PRD v2.0*