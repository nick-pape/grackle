// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner.js";

describe("UpdateBanner", () => {
  it("renders nothing when updateAvailable is false", () => {
    const { container } = render(
      <UpdateBanner
        currentVersion="0.76.0"
        latestVersion="0.76.0"
        updateAvailable={false}
        isDocker={false}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows banner with npm instructions when isDocker=false", () => {
    const { container } = render(
      <UpdateBanner
        currentVersion="0.76.0"
        latestVersion="0.77.0"
        updateAvailable={true}
        isDocker={false}
      />,
    );

    const banner = within(container).getByTestId("update-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("0.77.0");
    expect(banner.textContent).toContain("npm install");
  });

  it("shows banner with Docker instructions when isDocker=true", () => {
    const { container } = render(
      <UpdateBanner
        currentVersion="0.76.0"
        latestVersion="0.77.0"
        updateAvailable={true}
        isDocker={true}
      />,
    );

    const banner = within(container).getByTestId("update-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("docker pull");
  });

  it("displays current and latest versions", () => {
    const { container } = render(
      <UpdateBanner
        currentVersion="0.76.0"
        latestVersion="0.77.0"
        updateAvailable={true}
        isDocker={false}
      />,
    );

    const banner = within(container).getByTestId("update-banner");
    expect(banner.textContent).toContain("0.76.0");
    expect(banner.textContent).toContain("0.77.0");
  });
});
