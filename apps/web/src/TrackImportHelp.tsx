const exportGuides = [
  {
    name: "Strava",
    url: "https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data",
    steps: "On the website, open an activity → three-dot menu → Export GPX. The guide also covers bulk account exports.",
  },
  {
    name: "AllTrails",
    url: "https://support.alltrails.com/hc/en-us/articles/37230403315476-Downloading-files-from-AllTrails",
    steps: "On a desktop or laptop, open Profile → Activities → select an activity → three-dot menu → Download route → GPX Track.",
  },
  {
    name: "Komoot",
    url: "https://support.komoot.com/hc/en-us/articles/10115477099674-Export-and-import-Routes-and-Activities",
    steps: "In the app or website, open Profile → Completed activities → select an activity → Download GPX file.",
    note: "The starting region must be unlocked. Exports contain GPS geometry only.",
  },
  {
    name: "Garmin Connect",
    url: "https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8",
    steps: "On the website, open Activities → All Activities → select an activity → settings gear → Export to GPX.",
  },
];

export function TrackImportHelp() {
  return (
    <div className="track-import-help">
      <p className="muted">
        Download a GPX file from your activity app, then import it here. Choose a completed
        activity to bring in where you’ve been.
      </p>
      <ul className="track-export-guides">
        {exportGuides.map((guide) => (
          <li key={guide.name}>
            <a href={guide.url} target="_blank" rel="noopener noreferrer">
              How to export from {guide.name}
              <span className="track-guide-external" aria-label="opens in a new tab"> ↗</span>
            </a>
            <p>{guide.steps}</p>
            {guide.note && <p className="muted">{guide.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
