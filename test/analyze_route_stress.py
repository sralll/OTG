import sys
from pathlib import Path
import glob

import pandas as pd
import matplotlib.pyplot as plt


def find_latest_csv() -> Path:
    here = Path(__file__).resolve().parent
    files = sorted(glob.glob(str(here / "route-stress-*.csv")))
    if not files:
        sys.exit("No route-stress-*.csv found next to this script.")
    return Path(files[-1])


def main() -> None:
    csv_path = find_latest_csv()
    df = pd.read_csv(csv_path)

    # Drop rows without the timing column (e.g. failed runs).
    timing = df["pathfindingUntilFoundMs"]
    retries = df["retries"]

    # --- Plot 1: pathfindingUntilFoundMs over retries ---
    plt.figure(figsize=(8, 5))
    plt.scatter(retries, timing, alpha=0.6)
    plt.xlabel("retries")
    plt.ylabel("pathfindingUntilFoundMs")
    plt.title(f"pathfindingUntilFoundMs over retries\n({csv_path.name})")
    plt.grid(True, linestyle=":", alpha=0.5)
    plt.tight_layout()
    plt.savefig(csv_path.with_name("plot_pathfinding_vs_retries.png"), dpi=150)
    plt.close()

    # --- Plot 2: pathfindingUntilFoundMs over average route length ---
    # Only rows where exactly 2 route lengths are present; average those two
    # (ignore NaN/empty so they don't dilute the mean).
    route_cols = ["route1Length", "route2Length", "route3Length", "route4Length"]
    routes = df[route_cols].apply(pd.to_numeric, errors="coerce")
    counts = routes.notna().sum(axis=1)
    two_routes = df[counts == 2].copy()
    two_routes["avgRouteLength"] = routes[counts == 2].mean(axis=1, skipna=True)

    plt.figure(figsize=(8, 5))
    plt.scatter(two_routes["avgRouteLength"], two_routes["pathfindingUntilFoundMs"], alpha=0.6)
    plt.xlabel("average route length (2 present routes)")
    plt.ylabel("pathfindingUntilFoundMs")
    plt.title(f"pathfindingUntilFoundMs over average route length\n({csv_path.name}, n={len(two_routes)})")
    plt.grid(True, linestyle=":", alpha=0.5)
    plt.tight_layout()
    plt.savefig(csv_path.with_name("plot_pathfinding_vs_avg_route_length.png"), dpi=150)
    plt.close()

    # --- Plot 3: cityGenerationMs over size, colored by river/shore/walls ---
    gen = df[df["cityGenerationMs"].notna()]
    flags = [("river", "river"), ("shore", "shore"), ("walls", "walls")]
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), sharey=True)
    for ax, (col, label) in zip(axes, flags):
        off = gen[~gen[col].astype(bool)]
        on = gen[gen[col].astype(bool)]
        ax.scatter(off["size"], off["cityGenerationMs"], s=18, alpha=0.5,
                   color="#888", label=f"{label}=False (n={len(off)})")
        ax.scatter(on["size"], on["cityGenerationMs"], s=18, alpha=0.5,
                   color="#d62728", label=f"{label}=True (n={len(on)})")
        # Group means per size for each subgroup.
        if len(off):
            om = off.groupby("size")["cityGenerationMs"].mean()
            ax.plot(om.index, om.values, color="#888", linewidth=1.5)
        if len(on):
            nm = on.groupby("size")["cityGenerationMs"].mean()
            ax.plot(nm.index, nm.values, color="#d62728", linewidth=1.5)
        ax.set_xlabel("size")
        ax.set_title(label)
        ax.grid(True, linestyle=":", alpha=0.5)
        ax.legend(fontsize=8)
    axes[0].set_ylabel("cityGenerationMs")
    fig.suptitle(f"cityGenerationMs over size by feature\n({csv_path.name})")
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    fig.savefig(csv_path.with_name("plot_city_generation_vs_size.png"), dpi=150)
    plt.close(fig)

    # Summary: average effect of each flag on generation time.
    print(f"Read {len(df)} rows from {csv_path.name}")
    print(f"Plot 1: {len(df)} points -> plot_pathfinding_vs_retries.png")
    print(f"Plot 2: {len(two_routes)} points -> plot_pathfinding_vs_avg_route_length.png")
    print(f"Plot 3: {len(gen)} points -> plot_city_generation_vs_size.png")
    print("\nMean cityGenerationMs:")
    base = gen[~gen["river"].astype(bool) & ~gen["shore"].astype(bool) & ~gen["walls"].astype(bool)]
    print(f"  baseline (none):  {base['cityGenerationMs'].mean():.1f} ms (n={len(base)})")
    for col, label in flags:
        on_mean = gen[gen[col].astype(bool)]["cityGenerationMs"].mean()
        off_mean = gen[~gen[col].astype(bool)]["cityGenerationMs"].mean()
        print(f"  {label:5}=True:  {on_mean:7.1f} ms   {label:5}=False: {off_mean:7.1f} ms   delta={on_mean-off_mean:+.1f} ms")

    # --- Plot 4: pathfindingUntilFoundMs over straightLineDistance by feature ---
    pf = df[df["pathfindingUntilFoundMs"].notna() & df["straightLineDistance"].notna()]
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), sharey=True)
    for ax, (col, label) in zip(axes, flags):
        off = pf[~pf[col].astype(bool)]
        on = pf[pf[col].astype(bool)]
        ax.scatter(off["straightLineDistance"], off["pathfindingUntilFoundMs"], s=18, alpha=0.5,
                   color="#1f77b4", label=f"{label}=False (n={len(off)})")
        ax.scatter(on["straightLineDistance"], on["pathfindingUntilFoundMs"], s=18, alpha=0.5,
                   color="#d62728", label=f"{label}=True (n={len(on)})")
        if len(off):
            om = off.groupby(pd.cut(off["straightLineDistance"], bins=12))["pathfindingUntilFoundMs"].mean()
            centers = [iv.mid for iv in om.index]
            ax.plot(centers, om.values, color="#1f77b4", linewidth=1.5)
        if len(on):
            nm = on.groupby(pd.cut(on["straightLineDistance"], bins=12))["pathfindingUntilFoundMs"].mean()
            centers = [iv.mid for iv in nm.index]
            ax.plot(centers, nm.values, color="#d62728", linewidth=1.5)
        ax.set_xlabel("straight line distance")
        ax.set_title(label)
        ax.grid(True, linestyle=":", alpha=0.5)
        ax.legend(fontsize=8)
    axes[0].set_ylabel("pathfindingUntilFoundMs")
    fig.suptitle(f"pathfindingUntilFoundMs over straightLineDistance by feature\n({csv_path.name})")
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    fig.savefig(csv_path.with_name("plot_pathfinding_vs_straight_distance.png"), dpi=150)
    plt.close(fig)

    print(f"\nPlot 4: {len(pf)} points -> plot_pathfinding_vs_straight_distance.png")


if __name__ == "__main__":
    main()
