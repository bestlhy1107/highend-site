import { defineDb, defineTable, column } from "astro:db";

const Lead = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    name: column.text(),
    contact: column.text(),
    need: column.text(),
    source: column.text(),

    appointmentType: column.text({
      enum: ["trial", "consultation"],
    }),
    examType: column.text(),
    preferredTime: column.text({ optional: true }),

    status: column.text({
      enum: ["new", "contacted", "done", "invalid"],
    }),
    adminNote: column.text({ optional: true }),
    createdAt: column.date(),
    updatedAt: column.date(),
  },
  indexes: [{ on: ["status"] }, { on: ["createdAt"] }],
});

const CmsDocument = defineTable({
  columns: {
    key: column.text({ primaryKey: true }),
    value: column.text(),
    updatedAt: column.date(),
  },
  indexes: [{ on: ["updatedAt"] }],
});

export default defineDb({
  tables: { Lead, CmsDocument },
});
