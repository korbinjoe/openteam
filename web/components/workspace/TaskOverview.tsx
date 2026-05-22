import TaskInfoSidebar from './TaskInfoSidebar'
import GroupChat from './GroupChat'

const TaskOverview = () => (
  <div className="flex-1 flex overflow-hidden">
    <TaskInfoSidebar />
    <div className="flex-1 flex flex-col overflow-hidden">
      <GroupChat />
    </div>
  </div>
)

export default TaskOverview
