# Ebook Combos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell, deliver and display `Book` records of type `COMBO` while preserving all existing ebook product features.

**Architecture:** Extend the existing Book product with a `BookType` discriminator and relationships for current combo contents plus paid-order snapshots. Keep cart/order/affiliate relations on `Book`; expand combo snapshots only at payment confirmation, access checks, email attachment collection and the library projection.

**Tech Stack:** NestJS 11, Prisma/PostgreSQL, Jest, Next.js/React/TypeScript in admin and storefront.

**Spec:** `docs/superpowers/specs/2026-11-12-ebook-combos-design.md`

## Global Constraints

- Existing books migrate as `SINGLE` and all existing purchase, reader and download URLs remain compatible.
- A combo contains at least two active, unique `SINGLE` books created by the same seller.
- Combo price and affiliate commission use the combo Book record, never client supplied values or member-book prices.
- Delivery and Library use an immutable membership snapshot created when payment is confirmed.
- No cross-seller or nested combos.

## Review Focus

- A member book is later removed from or added to a combo; paid customers must retain their original snapshot.
- The same ebook is bought directly and through one or more combos in one order; e-mail attachments must not duplicate it.
- An unauthorised seller submits another seller's book ID; creation/update must reject it server-side.
- A combo is included in an affiliate purchase; its own attribution and commission must be retained.
- A customer accessing a member ebook only through a combo must pass both reader and download authorization.

---

### Task 1: Persist combo products and purchase snapshots

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_ebook_combos/migration.sql`
- Test: `tests/ebook-combos.integration.test.js`

**Interfaces:**
- Produces: `Book.type`, `Book.comboItems`, `Book.memberOfCombos`, `BookComboItem`, and paid order-combo snapshot relations.
- Consumes: existing `Book`, `Order`, and `OrderItem` relations.

- [ ] Write a failing Prisma-backed integration test proving existing book records default to `SINGLE` and a paid combo snapshot persists ordered member IDs.
- [ ] Run the test and confirm it fails because combo schema/relations do not exist.
- [ ] Add `BookType`, combo membership and immutable paid-order snapshot schema plus migration; migrate existing books to `SINGLE`.
- [ ] Re-run the test and confirm it passes.
- [ ] Commit the schema and migration.

### Task 2: Add backend combo validation and product APIs

**Files:**
- Modify: `src/book/book.service.ts`
- Modify: `src/book/book.controller.ts`
- Modify: `src/book/dto/*` (or existing create/update book DTO files)
- Test: `src/book/book.service.spec.ts` or `tests/ebook-combos.integration.test.js`

**Interfaces:**
- Produces: create/update/read responses containing `type`, member count and member summaries for combo products.
- Consumes: `Book.type`, combo membership schema, authenticated seller identity.

- [ ] Write failing tests for a valid same-seller combo and rejection of fewer than two, duplicate, inactive, combo-type and foreign-seller member IDs.
- [ ] Run the focused test and confirm the missing validation failure.
- [ ] Implement server-side validation, combo creation/update, membership ordering and detail/list projections while preserving single-book endpoints.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit backend product API work.

### Task 3: Snapshot, deliver and authorize combo purchases

**Files:**
- Modify: `src/checkout/checkout.service.ts`
- Modify: `src/book/book.service.ts`
- Modify: `src/book/book.controller.ts`
- Test: `tests/ebook-checkout.integration.test.js`
- Test: `tests/ebook-combos.integration.test.js`

**Interfaces:**
- Produces: paid combo membership snapshots, deduplicated attachment input and member-book purchase authorization.
- Consumes: combo Books in existing cart/order items and existing idempotent confirmation flow.

- [ ] Write failing tests that payment of a combo snapshots members, grants a member read/download access and creates one deduplicated attachment set with individual order books.
- [ ] Run the focused tests and confirm they fail before the new behavior.
- [ ] Create snapshots only during idempotent paid confirmation; expand snapshots for e-mail delivery and `userHasPurchasedBook` authorization.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit payment and delivery work.

### Task 4: Expose combo purchases in the Library API

**Files:**
- Modify: `src/book/book.service.ts`
- Modify: `src/book/book.controller.ts`
- Test: `tests/ebook-combos.integration.test.js`

**Interfaces:**
- Produces: a backwards-compatible purchased-products response in which combo entries carry `type: COMBO`, cover/title and immutable member ebook summaries.
- Consumes: paid order snapshots and existing purchased-book pagination.

- [ ] Write a failing test asserting a paid combo is one library entry with its snapshot members and a single book remains the legacy shape.
- [ ] Run the test and confirm it fails on the current flat-book response.
- [ ] Implement the compatible projection and pagination metadata.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit Library API work.

### Task 5: Add seller combo controls to the admin application

**Files:**
- Modify: `admin-ebook/src/types/books/books.types.ts`
- Modify: `admin-ebook/src/services/api/admin/admin.ts`
- Modify: `admin-ebook/src/components/books/BookForm.tsx`
- Modify: `admin-ebook/src/components/books/BookList.tsx`
- Modify: `admin-ebook/src/components/books/BookFilters.tsx`
- Test: relevant existing admin component tests, or create focused tests beside the components.

**Interfaces:**
- Consumes: backend Book DTO `type`, `comboBookIds` and member summaries.
- Produces: seller create/edit UX for combo products and type-aware list/filter rendering.

- [ ] Write a failing component/API test for selecting Combo, choosing own active books and submitting `comboBookIds` without a file upload.
- [ ] Run the test and confirm it fails before the type-aware form exists.
- [ ] Add type selection, member selector, type-specific validation and combo badges/filters while retaining every standard commercial field.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit admin work.

### Task 6: Render and open combos in the storefront

**Files:**
- Modify: `front-ebook/src/types/dashboard/book.types.ts`
- Modify: `front-ebook/src/types/library/library.types.ts`
- Modify: `front-ebook/src/api/library/get-purchased-books.ts`
- Modify: `front-ebook/src/components/dashboard/BookCard.tsx`
- Modify: `front-ebook/src/app/book/[id]/page.tsx`
- Modify: `front-ebook/src/components/library/LibraryCard.tsx`
- Modify: `front-ebook/src/components/library/LibraryGrid.tsx`
- Modify: `front-ebook/src/app/library/page.tsx`
- Test: focused storefront component/API tests.

**Interfaces:**
- Consumes: type-aware catalog/detail and Library responses.
- Produces: combo badges, member list in product detail and a library combo expansion that links members to existing reader/download behavior.

- [ ] Write a failing test for a combo library card expanding to member links and a catalog card displaying the combo type/count.
- [ ] Run the test and confirm it fails on the single-book-only components.
- [ ] Implement type-aware product rendering, combo details and expandable Library cards; reuse current member-book routes for reading/downloading.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit storefront work.

### Task 7: Validate cross-application behavior

**Files:**
- Modify: only defects found in Tasks 1–6.
- Test: backend combo tests plus each affected application test command.

- [ ] Run backend focused tests, Prisma generation and build.
- [ ] Run admin and storefront test/typecheck/build commands available in their package scripts.
- [ ] Manually verify the sequence: create combo → affiliate link/cart → paid order → one e-mail → combo Library card → member reader/download.
- [ ] Commit any test-backed fixes.
