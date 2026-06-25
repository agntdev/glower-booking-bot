# GlowEr Booking & Portfolio Bot — Bot specification

**Archetype:** booking

A Telegram bot for GlowEr beauty studio that lets customers browse services and portfolio, read and add photo reviews, and book appointments. The bot sends a follow-up message 1 hour after each appointment inviting a review (with photo upload). Studio staff (admins) can manage services and portfolio photos, respond to or remove reviews, and receive booking notifications.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- New and returning clients of GlowEr who want to view services/portfolio and book appointments via Telegram.
- Studio staff/admins who manage services, portfolio, bookings and reviews via admin-only bot controls.

## Success criteria

- Customers can successfully book appointments through the bot interface
- Admins can manage services, portfolio, and reviews through admin controls
- Post-appointment review follow-up is sent to users 1 hour after each appointment

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu with options: Book service, View portfolio, Reviews, My bookings, Contact
- **Book service** (button, actor: user, callback: booking:start) — Initiates the booking flow by showing available services with descriptions, duration, price, and thumbnails
  - inputs: Service selection, Date selection, Time slot selection, Contact information, Appointment notes
  - outputs: Booking confirmation, Admin notification
- **View portfolio** (button, actor: user, callback: portfolio:view) — Displays paged portfolio images with captions, filtered by service if applicable
  - inputs: Service filter (optional)
  - outputs: Portfolio items with captions
- **Reviews** (button, actor: user, callback: reviews:view) — Shows publicly visible reviews with optional photos
  - inputs: Leave review now/Later/Skip
  - outputs: Review submission interface, Publicly visible review
- **My bookings** (button, actor: user, callback: bookings:view) — Displays user's current and past bookings with options to view or cancel
  - inputs: Booking selection, Cancel confirmation
  - outputs: Booking details, Cancellation confirmation
- **Contact** (button, actor: user, callback: contact:start) — Provides contact information or message interface for the studio
  - inputs: Message text (optional)
  - outputs: Contact information, Message sent confirmation
- **/admin** (command, actor: admin, command: /admin) — Opens admin menu for service/portfolio management and review moderation
  - inputs: Admin command selection
  - outputs: Admin interface options

## Flows

### Onboarding
_Trigger:_ /start

1. Display welcome message with GlowEr studio name
2. Show primary options: Book service, View portfolio, Reviews, My bookings, Contact

_Data touched:_ User

### Service browsing
_Trigger:_ booking:start

1. Show list of services with brief descriptions, duration, price, and thumbnails
2. Display service-specific options: Book this, View portfolio (filtered), More details

_Data touched:_ Service

### Booking flow
_Trigger:_ booking:start

1. Select service
2. Choose date from calendar UI
3. Choose available time slot
4. Confirm details
5. Collect contact info (Telegram name + phone number if missing)
6. Optional: add appointment notes
7. Confirm booking with service, date/time, duration, contact
8. Send booking confirmation to user
9. Notify admin(s) of new booking

_Data touched:_ Booking, User

### Portfolio viewing
_Trigger:_ portfolio:view

1. Display paged images with captions
2. Filter by service if applicable

_Data touched:_ Portfolio item

### Review submission
_Trigger:_ reviews:submit

1. Prompt user to leave review after appointment
2. Accept text + up to 10 photos
3. Publish review immediately with admin moderation option

_Data touched:_ Review

### Post-appointment follow-up
_Trigger:_ appointment:end

1. Send follow-up message 1 hour after appointment end time
2. Offer options: Leave review now / Later / Skip

_Data touched:_ Review

### Admin service management
_Trigger:_ /admin

1. Create/edit/deactivate services
2. Set duration & price
3. Upload service photos

_Data touched:_ Service

### Admin portfolio management
_Trigger:_ /admin

1. Upload/delete images
2. Add captions
3. Tag by service

_Data touched:_ Portfolio item

### Admin booking management
_Trigger:_ /admin

1. View bookings list
2. Accept/cancel bookings
3. Receive booking notifications

_Data touched:_ Booking

### Review moderation
_Trigger:_ /admin

1. View reviews
2. Reply to reviews
3. Remove reviews

_Data touched:_ Review

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram user with name, phone number, preferences, and timezone (configurable)
  - fields: Telegram user ID, Name, Phone number, Preferences, Timezone
- **Service** _(retention: persistent)_ — Beauty service with title, description, duration, price, photos, category, and active status
  - fields: Title, Description, Duration (minutes), Price, Photos, Category, Active flag
- **Booking** _(retention: persistent)_ — Appointment with user, service, date & start time, duration, status, notes, and creation timestamp
  - fields: User ID, Service ID, Date & start time, Duration, Status, Notes, Created at
- **Portfolio item** _(retention: persistent)_ — Image with caption, service tags, and creation timestamp
  - fields: Image(s), Caption, Service tags, Created at
- **Review** _(retention: persistent)_ — User review with optional rating, text, photos, timestamp, and admin visibility flag
  - fields: User ID, Rating, Text, Photos, Timestamp, Admin visible flag
- **Admin account** _(retention: persistent)_ — Telegram user IDs with elevated rights for managing the bot
  - fields: Telegram user ID, Admin rights

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure admin accounts
- Set studio timezone
- Adjust business hours
- Modify service details
- Manage portfolio items
- Moderate reviews
- View and manage bookings

## Notifications

- Booking confirmation to user
- Admin notification of new booking
- Post-appointment review follow-up to user
- Admin notification of new review
- Booking status changes (confirmed, cancelled, completed)

## Permissions & privacy

- User data (name, phone number, preferences, timezone) is stored securely and only used for appointment purposes
- Review photos are stored and displayed with user consent
- Admins have access to manage content and reviews but cannot access user data beyond what's necessary for their role
- All data is retained for audit and management purposes as per studio policy

## Edge cases

- User tries to book overlapping appointments
- User cancels appointment after confirmation
- Admin removes a review after it's been published
- User submits a review without photos
- User submits a review with more than 10 photos
- User tries to book outside business hours
- User has no phone number and declines to provide one
- Admin tries to edit a service that's already booked

## Required tests

- Verify that users can successfully book and cancel appointments through the bot interface
- Test that post-appointment review follow-up is sent exactly 1 hour after each appointment
- Validate that admin controls properly restrict access to management functions
- Confirm that portfolio and review images are displayed correctly with proper filtering
- Test that business hours and timezone settings affect appointment availability correctly

## Assumptions

- Language is set to English as per the provided studio name and no language was specified
- Timezone defaults to server/local timezone but admin can set studio timezone at onboarding
- Business hours default to Mon–Sat 09:00–18:00
- Slot granularity is 15-minute increments
- Contact info collected includes Telegram name plus phone number prompt if missing
- Admin notifications are sent to configured admin Telegram account(s)/chat
- Reviews are published immediately and visible to other users with admin moderation capability
- Photo limits are up to 10 photos per review with max 5 MB per image
- No payment or deposit is required for bookings in v1
