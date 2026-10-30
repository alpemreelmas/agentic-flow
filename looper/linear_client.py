"""Shared Linear transport. Credentials never appear in transport exceptions."""
import httpx


class LinearError(RuntimeError):
    pass


class LinearClient:
    URL = "https://api.linear.app/graphql"

    def __init__(self, key):
        self.h = {"Authorization": key}

    def gql(self, query, variables=None):
        try:
            response = httpx.post(self.URL, json={"query": query, "variables": variables or {}},
                                  headers=self.h, timeout=30)
            response.raise_for_status()
            body = response.json()
        except httpx.TimeoutException:
            raise LinearError("Linear request timed out; a mutation may have succeeded") from None
        except httpx.HTTPStatusError as exc:
            raise LinearError(f"Linear returned HTTP {exc.response.status_code}; check connection and permissions") from None
        except (httpx.HTTPError, ValueError):
            raise LinearError("Linear connection failed; check your connection and retry") from None
        if body.get("errors"):
            # API messages are useful for configuration mistakes; remove the credential if echoed.
            message = str(body["errors"]).replace(self.h["Authorization"], "[redacted]")
            raise LinearError(message)
        if not isinstance(body.get("data"), dict):
            raise LinearError("Linear returned an invalid response")
        return body["data"]
