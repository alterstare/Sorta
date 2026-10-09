import type { JSX } from 'react'

// Material Symbols (filled, 24px grid) — same set/style as Halftone. Inherit
// color via currentColor and size from the parent's font-size (1.15em).
interface IconProps {
  className?: string
}

function mkIcon(path: string) {
  return function Icon({ className }: IconProps): JSX.Element {
    return (
      <svg className={`micon ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    )
  }
}

export const PhotoLibraryIcon = mkIcon(
  'M9 14h10l-3.45-4.5l-2.3 3l-1.55-2zm-1 4q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm-4 4q-.825 0-1.412-.587T2 20V6h2v14h14v2z'
)
export const FactCheckIcon = mkIcon(
  'M4 21q-.825 0-1.412-.587T2 19V5q0-.825.588-1.412T4 3h16q.825 0 1.413.588T22 5v14q0 .825-.587 1.413T20 21zm1-4h5v-2H5zm9.55-2l4.95-4.95l-1.425-1.425l-3.525 3.55l-1.425-1.425l-1.4 1.425zM5 13h5v-2H5zm0-4h5V7H5z'
)
export const HelpIcon = mkIcon(
  'M12.838 17.638q.362-.363.362-.888t-.362-.888t-.888-.362t-.887.363t-.363.887t.363.888t.887.362t.888-.363M11.05 14.15h1.85q0-.825.188-1.3t1.062-1.3q.65-.65 1.025-1.238T15.55 8.9q0-1.4-1.025-2.15T12.1 6q-1.425 0-2.312.75T8.55 8.55l1.65.65q.125-.45.563-.975T12.1 7.7q.8 0 1.2.438t.4.962q0 .5-.3.938t-.75.812q-1.1.975-1.35 1.475t-.25 1.825M12 22q-2.075 0-3.9-.787t-3.175-2.138T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22'
)
export const PersonIcon = mkIcon(
  'M9.175 10.825Q8 9.65 8 8t1.175-2.825T12 4t2.825 1.175T16 8t-1.175 2.825T12 12t-2.825-1.175M4 20v-2.8q0-.85.438-1.562T5.6 14.55q1.55-.775 3.15-1.162T12 13t3.25.388t3.15 1.162q.725.375 1.163 1.088T20 17.2V20z'
)
export const SettingsIcon = mkIcon(
  'm9.25 22l-.4-3.2q-.325-.125-.612-.3t-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375t.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3t.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375t-.6.3l-.4 3.2zm2.8-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5'
)
export const FolderOpenIcon = mkIcon(
  'M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8H4v10l2.4-8h17.1l-2.575 8.575q-.2.65-.737 1.038T19 20z'
)
export const GridViewIcon = mkIcon('M3 11V3h8v8zm0 10v-8h8v8zm10-10V3h8v8zm0 10v-8h8v8z')
export const SearchIcon = mkIcon(
  'm19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14'
)
export const AddIcon = mkIcon('M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z')
export const DeleteIcon = mkIcon(
  'M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zm2-4h2V8H9zm4 0h2V8h-2z'
)
export const DownloadIcon = mkIcon(
  'm12 16l-5-5l1.4-1.45l2.6 2.6V4h2v8.15l2.6-2.6L17 11zm-6 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z'
)
export const PlayIcon = mkIcon('M8 19V5l11 7z')
export const WarningIcon = mkIcon(
  'M1 21L12 2l11 19zm11.713-3.287Q13 17.425 13 17t-.288-.712T12 16t-.712.288T11 17t.288.713T12 18t.713-.288M11 15h2v-5h-2z'
)
export const CloseIcon = mkIcon(
  'M6.4 19L5 17.6l5.6-5.6L5 6.4L6.4 5l5.6 5.6L17.6 5L19 6.4L13.4 12l5.6 5.6l-1.4 1.4l-5.6-5.6z'
)
export const KeyboardArrowLeftIcon = mkIcon('m14 18l-6-6l6-6l1.4 1.4l-4.6 4.6l4.6 4.6z')
export const KeyboardArrowRightIcon = mkIcon('M12.6 12L8 7.4L9.4 6l6 6l-6 6L8 16.6z')
export const ArrowDownIcon = mkIcon('m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z')
export const ArrowUpIcon = mkIcon('m12 10.8l-4.6 4.6L6 14l6-6l6 6l-1.4 1.4z')
export const RestartIcon = mkIcon(
  'M11 20.95q-3.025-.375-5.012-2.637T4 13q0-1.65.65-3.162T6.5 7.2l1.425 1.425q-.95.85-1.437 1.975T6 13q0 2.2 1.4 3.888T11 18.95zm2 0v-2q2.175-.4 3.588-2.075T18 13q0-2.5-1.75-4.25T12 7h-.075l1.1 1.1l-1.4 1.4l-3.5-3.5l3.5-3.5l1.4 1.4l-1.1 1.1H12q3.35 0 5.675 2.325T20 13q0 3.025-1.987 5.288T13 20.95'
)
export const CheckIcon = mkIcon('m9.55 18l-5.7-5.7l1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z')
export const SkipNextIcon = mkIcon('M16.5 18V6h2v12zm-11 0V6l9 6z')
export const PersonOffIcon = mkIcon(
  'M19.775 22.625L17.15 20H4v-2.8q0-.85.438-1.562T5.6 14.55q1.125-.575 2.288-.925t2.362-.525L1.375 4.225L2.8 2.8l18.4 18.4zM18.4 14.55q.725.35 1.15 1.062T20 17.15l-3.35-3.35q.45.175.888.35t.862.4m-4.2-3.2L8.65 5.8q.575-.85 1.45-1.325T12 4q1.65 0 2.825 1.175T16 8q0 1.025-.475 1.9T14.2 11.35'
)
export const UndoIcon = mkIcon(
  'M7 19v-2h7.1q1.575 0 2.738-1T18 13.5T16.838 11T14.1 10H7.8l2.6 2.6L9 14L4 9l5-5l1.4 1.4L7.8 8h6.3q2.425 0 4.163 1.575T20 13.5t-1.737 3.925T14.1 19z'
)
export const EditIcon = mkIcon(
  'M3 21v-4.25L16.2 3.575q.3-.275.663-.425t.762-.15t.775.15t.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763t-.438.662L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z'
)
export const PersonAddIcon = mkIcon(
  'M18 14v-3h-3V9h3V6h2v3h3v2h-3v3zM6.175 10.825Q5 9.65 5 8t1.175-2.825T9 4t2.825 1.175T13 8t-1.175 2.825T9 12t-2.825-1.175M1 20v-2.8q0-.85.438-1.562T2.6 14.55q1.55-.775 3.15-1.162T9 13t3.25.388t3.15 1.162q.725.375 1.163 1.088T17 17.2V20z'
)
export const DriveFileMoveIcon = mkIcon(
  'M12.15 14l-1.6 1.6L12 17l4-4l-4-4l-1.45 1.4l1.6 1.6H8v2zM4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z'
)
export const MergeIcon = mkIcon(
  'M6.4 20L5 18.6l5-5V5.825l-1.6 1.6L7 6l4-4l4 4l-1.4 1.425l-1.6-1.6v8.6zm11.2 0l-3.6-3.6l1.4-1.4l3.6 3.6z'
)
export const OpenInNewIcon = mkIcon(
  'M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h7v2H5v14h14v-7h2v7q0 .825-.587 1.413T19 21zm4.7-5.3l-1.4-1.4L17.6 5H14V3h7v7h-2V6.4z'
)
const FAV_FILLED =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7z'
const FAV_OUTLINE =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3'
// Favorite heart (same as Halftone): outline, or solid when `filled`.
export function FavoriteIcon({ className, filled }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg className={`micon ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={filled ? FAV_FILLED : FAV_OUTLINE} />
    </svg>
  )
}
export const StarIcon = mkIcon('m5.825 21l1.625-7.025L2 9.25l7.2-.625L12 2l2.8 6.625l7.2.625l-5.45 4.725L18.175 21L12 17.275z')
export const GridIcon = mkIcon('M2 10V2h8v8zm0 12v-8h8v8zm12-12V2h8v8zm0 12v-8h8v8z')
export const ListIcon = mkIcon('M3 18v-2h18v2zm0-5v-2h18v2zm0-5V6h18v2z')
export const ContentCopyIcon = mkIcon(
  'M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm-4 4q-.825 0-1.412-.587T3 20V6h2v14h11v2z'
)
export const FilterIcon = mkIcon('M10 18v-2h4v2zm-4-5v-2h12v2zM3 8V6h18v2z')
export const SortIcon = mkIcon('M3 18v-2h6v2zm0-5v-2h12v2zm0-5V6h18v2z')
export const VisibilityIcon = mkIcon(
  'M12 16q1.875 0 3.188-1.312T16.5 11.5t-1.312-3.187T12 7T8.813 8.313T7.5 11.5t1.313 3.188T12 16m0-1.8q-1.125 0-1.912-.788T9.3 11.5t.788-1.912T12 8.8t1.913.788t.787 1.912t-.787 1.913T12 14.2m0 4.8q-3.65 0-6.65-2.037T1 11.5q1.35-3.425 4.35-5.462T12 4t6.65 2.038T23 11.5q-1.35 3.425-4.35 5.463T12 19'
)
export const UploadIcon = mkIcon('M11 16V7.85l-2.6 2.6L7 9l5-5l5 5l-1.4 1.45l-2.6-2.6V16zm-5 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z')
export const SaveAltIcon = mkIcon('M6 20q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20zm6-4l-5-5l1.4-1.45l2.6 2.6V4h2v8.15l2.6-2.6L17 11z')
export const FolderIcon = mkIcon('M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z')
