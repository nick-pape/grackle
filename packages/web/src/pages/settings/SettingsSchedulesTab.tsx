import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { NEW_SCHEDULE_URL, ScheduleManager, scheduleUrl, useAppNavigate, useToast } from "@grackle-ai/web-components";

/** Settings tab wrapping the schedule list. */
export function SettingsSchedulesTab(): JSX.Element {
  const { schedules: { schedules, deleteSchedule, updateSchedule }, personas: { personas } } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();

  return (
    <ScheduleManager
      schedules={schedules}
      personas={personas}
      onDeleteSchedule={async (scheduleId) => {
        try {
          await deleteSchedule(scheduleId);
        } catch (error) {
          console.error("Failed to delete schedule", { scheduleId, error });
          showToast("Failed to delete schedule", "error");
          throw error;
        }
      }}
      onToggleEnabled={async (scheduleId, fields) => {
        try {
          return await updateSchedule(scheduleId, fields);
        } catch (error) {
          console.error("Failed to update schedule", { scheduleId, error });
          showToast("Failed to update schedule", "error");
          throw error;
        }
      }}
      onNavigateToNew={() => navigate(NEW_SCHEDULE_URL)}
      onNavigateToSchedule={(id) => navigate(scheduleUrl(id))}
    />
  );
}
