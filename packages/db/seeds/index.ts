import { PrismaClient } from "@prisma/client";
import { DEFAULT_TODO_TEMPLATES } from "./templates";
const prisma = new PrismaClient();

async function main() {
    if (process.env.NODE_ENV !== "development") {
        console.log("Skipping seeds in non-development env");
        return;
    }
    const count = await prisma.todoTemplate.count();
    if (count === 0) {
        await prisma.todoTemplate.createMany({ data: DEFAULT_TODO_TEMPLATES });
    }
}
main().finally(() => prisma.$disconnect());
