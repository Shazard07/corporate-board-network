import requests
from bs4 import BeautifulSoup


def extract_board_composition(url: str, headers: dict = None, timeout: int = 10):
    headers = headers or {"User-Agent": "Mozilla/5.0 (compatible; scraping-example/1.0)"}
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Try to find the heading and then the next list (site HTML may vary)
    heading = soup.find(lambda t: t.name in ("h2", "h3", "h4") and "Composition of the Board" in t.get_text())
    names = []
    if heading:
        # often the names are in the next <ul> or <div>
        container = heading.find_next(["ul", "div", "table"])
        if container:
            # handle <ul>/<li>
            lis = container.find_all("li")
            if lis:
                raw_data = [li.get_text(strip=True) for li in lis]
            else:
                # fallback: find text lines
                text = container.get_text(separator="\n").strip()
                raw_data = [line.strip() for line in text.splitlines() if line.strip()]
            
            # Filter to extract only person names
            names = filter_person_names(raw_data)
    return names


def filter_person_names(raw_data):
    """Filter raw data to extract person names by finding items that come right before age patterns."""
    import re
    
    person_names = []
    
    # Age pattern to identify the next item after a name
    age_pattern = r'^\d+\s*year'
    
    # Look for items that are followed by age patterns
    for i, item in enumerate(raw_data):
        item = item.strip()
        if not item:
            continue
            
        # Check if the next item is an age pattern
        if i + 1 < len(raw_data):
            next_item = raw_data[i + 1].strip()
            if re.match(age_pattern, next_item, re.IGNORECASE):
                # Current item is likely a person name since it's followed by an age
                person_names.append(item)
    
    return person_names


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        # Default URL if none is provided
        url = "https://www.marketscreener.com/quote/stock/UOL-GROUP-LIMITED-6491133/company-governance/"
    
    try:
        names = extract_board_composition(url)
        if names:
            print("Found names:")
            for n in names:
                print("- ", n)
        else:
            print("No names found using the heuristic.")
    except Exception as e:
        print("Error:", e)
