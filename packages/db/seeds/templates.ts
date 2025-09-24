import { prisma } from "../src/client";

const DEFAULTS = [
    { title: "Book outbound flight", kind: "booking" },
    { title: "Book return flight", kind: "booking" },
    { title: "Reserve hotel / lodging", kind: "booking" },
    { title: "Buy travel insurance", kind: "booking" },
    { title: "Add passports / IDs to Wallet", kind: "docs" },
    { title: "Check visa requirements", kind: "docs" },
    { title: "Enable international roaming / eSIM", kind: "prep" },
    { title: "Download offline maps", kind: "prep" },
    { title: "Notify bank of travel", kind: "prep" },
    { title: "Pack meds + chargers + adapters", kind: "packing" },
];

(async () => {
    if (process.env.NODE_ENV !== "development") {
        console.log("Skipping seed in non-dev");
        process.exit(0);
    }
    const n = await prisma.todoTemplate.count();
    if (n === 0) await prisma.todoTemplate.createMany({ data: DEFAULTS });
    console.log("Seeded todo templates.");
    process.exit(0);
})();
