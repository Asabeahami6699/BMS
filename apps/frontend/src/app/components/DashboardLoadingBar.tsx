type Props = {
  active: boolean;
};

export function DashboardLoadingBar({ active }: Props) {
  return (
    <div
      className={`dash-page-loader${active ? " is-active" : ""}`}
      role="progressbar"
      aria-hidden={!active}
      aria-busy={active}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="dash-page-loader__track">
        <span className="dash-page-loader__beam dash-page-loader__beam--left" />
        <span className="dash-page-loader__beam dash-page-loader__beam--right" />
      </div>
    </div>
  );
}
